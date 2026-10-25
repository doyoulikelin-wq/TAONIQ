/* Perspective view of the original numerical xyz trajectory. Camera controls
 * change only the view: neither coordinates nor the shared world radius change.
 * Each depth bucket contains original adjacent edges, never reordered points.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TaoView3D = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEG = Math.PI / 180;
  const DEPTH_BUCKETS = 12;
  const scratchByCanvas = new WeakMap();

  function cameraBasis(camera) {
    camera = camera || {};
    const az = (Number.isFinite(camera.azimuth) ? camera.azimuth : -72) * DEG;
    const el = (Number.isFinite(camera.elevation) ? camera.elevation : 18) * DEG;
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    return {
      right: [-sa, ca, 0],
      up: [-se * ca, -se * sa, ce],
      towardEye: [ce * ca, ce * sa, se]
    };
  }

  function view(projection, camera, width, height, zoom) {
    if (!projection || !Array.isArray(projection.center) || projection.center.length !== 3 ||
        !projection.center.every(Number.isFinite) || !Number.isFinite(projection.radius) || projection.radius <= 0) {
      throw new Error('3D 视图需要固定、有效的共享中心与半径');
    }
    const radius = projection.radius;
    const distance = radius * 3.2;
    return {
      ...cameraBasis(camera), center: projection.center, radius, distance,
      near: radius * 0.04,
      // At the center plane, this matches the previous shared world scale.
      focal: (Number.isFinite(zoom) && zoom > 0 ? zoom : 1) * 0.46 * Math.min(width, height) * distance / radius,
      width, height
    };
  }

  function projectPoint(point, options) {
    const v = view(options.projection, options.camera, options.width, options.height, options.zoom);
    const x = point[0] - v.center[0], y = point[1] - v.center[1], z = point[2] - v.center[2];
    const cameraX = x * v.right[0] + y * v.right[1] + z * v.right[2];
    const cameraY = x * v.up[0] + y * v.up[1] + z * v.up[2];
    const depth = v.distance - (x * v.towardEye[0] + y * v.towardEye[1] + z * v.towardEye[2]);
    const finite = Number.isFinite(cameraX) && Number.isFinite(cameraY) && Number.isFinite(depth);
    const visible = finite && depth >= v.near;
    return {
      x: visible ? v.width / 2 + v.focal * cameraX / depth : null,
      y: visible ? v.height / 2 - v.focal * cameraY / depth : null,
      depth, finite, visible,
      perspective: visible ? v.distance / depth : null
    };
  }

  function scratch(canvas, count) {
    let s = scratchByCanvas.get(canvas);
    if (!s || s.x.length < count) {
      s = {x: new Float64Array(count), y: new Float64Array(count), z: new Float64Array(count),
        finite: new Uint8Array(count), buckets: Array.from({length: DEPTH_BUCKETS}, () => [])};
      scratchByCanvas.set(canvas, s);
    }
    s.buckets.forEach(bucket => {bucket.length = 0;});
    return s;
  }

  function reticle(ctx, width, height) {
    ctx.strokeStyle = '#19362b'; ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let j = 0; j < 4; j++) {
      const x = j % 2 ? width - 13 : 13, y = j < 2 ? 12 : height - 12;
      ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y);
      ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3);
    }
    ctx.stroke();
  }

  function axes(ctx, v) {
    const ox = 33, oy = v.height - 32, length = 20;
    const colors = ['#be776b', '#87b998', '#89a9cf'];
    ctx.lineWidth = 1; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // This small orientation key uses the same camera basis. It is a legend,
    // not a second trajectory or a data-dependent reference frame.
    for (let axis = 0; axis < 3; axis++) {
      const x = ox + v.right[axis] * length, y = oy - v.up[axis] * length;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(x, y);
      ctx.strokeStyle = colors[axis]; ctx.stroke();
      ctx.fillStyle = colors[axis];
      if (typeof ctx.fillText === 'function') ctx.fillText('XYZ'[axis], ox + v.right[axis] * (length + 7), oy - v.up[axis] * (length + 7));
    }
  }

  function draw(canvas, points, options) {
    options = options || {};
    const empty = {clipped: 0, count: 0, segments: 0, invalid: 0, nearClipped: 0, finite: 0, perspective: true};
    if (!canvas || typeof canvas.getContext !== 'function') return {...empty, available: false};
    const ctx = canvas.getContext('2d');
    if (!ctx) return {...empty, available: false};
    const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : {};
    const width = Math.max(1, rect.width || canvas.clientWidth || 320), height = Math.max(1, rect.height || canvas.clientHeight || 300);
    const dpr = Math.max(0.5, Math.min(Number.isFinite(options.dpr) ? options.dpr : 1, 2));
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    reticle(ctx, width, height);
    const v = view(options.projection, options.camera, width, height, options.zoom);
    if (!points || points.length < 3) {axes(ctx, v); return {...empty, available: true};}
    const count = Math.floor(points.length / 3), s = scratch(canvas, count);
    const color = Array.isArray(options.color) ? options.color.slice(0, 3).map(c => Math.max(0, Math.min(255, Math.round(c)))) : [137, 213, 180];
    const rgb = color.join(',');
    let clipped = 0, invalid = 0, nearClipped = 0, finite = 0, segments = 0;
    let lastVisible = -1, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const j = i * 3, x = points[j] - v.center[0], y = points[j + 1] - v.center[1], z = points[j + 2] - v.center[2];
      s.x[i] = x * v.right[0] + y * v.right[1] + z * v.right[2];
      s.y[i] = x * v.up[0] + y * v.up[1] + z * v.up[2];
      s.z[i] = v.distance - (x * v.towardEye[0] + y * v.towardEye[1] + z * v.towardEye[2]);
      s.finite[i] = Number.isFinite(s.x[i]) && Number.isFinite(s.y[i]) && Number.isFinite(s.z[i]) ? 1 : 0;
      if (!s.finite[i]) {invalid++; continue;}
      finite++;
      if (s.z[i] < v.near) {nearClipped++; clipped++; continue;}
      const px = width / 2 + v.focal * s.x[i] / s.z[i], py = height / 2 - v.focal * s.y[i] / s.z[i];
      if (px < 0 || px > width || py < 0 || py > height) clipped++;
      lastVisible = i; minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
    for (let i = 1; i < count; i++) {
      if (!s.finite[i - 1] || !s.finite[i] || (s.z[i - 1] < v.near && s.z[i] < v.near)) continue;
      const depth = (s.z[i - 1] + s.z[i]) / 2;
      // Fixed world-depth bins make brightness comparable across both views.
      const bucket = Math.max(0, Math.min(DEPTH_BUCKETS - 1, Math.floor((v.distance + v.radius - depth) / (2 * v.radius) * DEPTH_BUCKETS)));
      s.buckets[bucket].push(i); segments++;
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let b = 0; b < DEPTH_BUCKETS; b++) {
      if (!s.buckets[b].length) continue;
      ctx.beginPath();
      for (const i of s.buckets[b]) {
        let ax = s.x[i - 1], ay = s.y[i - 1], az = s.z[i - 1];
        let bx = s.x[i], by = s.y[i], bz = s.z[i];
        // Clip an original edge at the camera near plane. This never joins
        // across an invalid sample or introduces a different trajectory.
        if (az < v.near) {const t = (v.near - az) / (bz - az); ax += (bx - ax) * t; ay += (by - ay) * t; az = v.near;}
        if (bz < v.near) {const t = (v.near - bz) / (az - bz); bx += (ax - bx) * t; by += (ay - by) * t; bz = v.near;}
        ctx.moveTo(width / 2 + v.focal * ax / az, height / 2 - v.focal * ay / az);
        ctx.lineTo(width / 2 + v.focal * bx / bz, height / 2 - v.focal * by / bz);
      }
      const near = b / (DEPTH_BUCKETS - 1);
      ctx.strokeStyle = `rgba(${rgb},${(0.13 + 0.63 * near).toFixed(3)})`;
      ctx.lineWidth = 0.42 + 0.60 * near; ctx.stroke();
    }
    if (lastVisible >= 0) {
      const px = width / 2 + v.focal * s.x[lastVisible] / s.z[lastVisible], py = height / 2 - v.focal * s.y[lastVisible] / s.z[lastVisible];
      // A tiny endpoint marker also keeps a true fixed point visible, without
      // expanding its geometry into an apparent orbit.
      const nearPoint = maxX - minX < 0.8 && maxY - minY < 0.8;
      ctx.beginPath(); ctx.arc(px, py, nearPoint ? 2.4 : 1.5, 0, Math.PI * 2); ctx.fillStyle = `rgb(${rgb})`; ctx.fill();
    }
    axes(ctx, v);
    return {clipped, count, segments, invalid, nearClipped, finite, perspective: true, available: true};
  }

  return Object.freeze({draw, cameraBasis, projectPoint, depthBuckets: DEPTH_BUCKETS, cameraDistanceRadii: 3.2});
});
