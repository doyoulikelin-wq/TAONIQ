'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const View = require('../assets/view3d.js');

const projection = {center: [0, 0, 0], radius: 4};
const camera = {azimuth: 0, elevation: 0};
const opts = {projection, camera, width: 400, height: 400, zoom: 1, color: [137, 213, 180], dpr: 1};
function mockCanvas(width = 400, height = 400) {
  const strokes = [], arcs = [], labels = []; let path = [];
  const ctx = {
    setTransform() {}, clearRect() {}, beginPath() {path = [];},
    moveTo(x, y) {path.push(['M', x, y]);}, lineTo(x, y) {path.push(['L', x, y]);},
    stroke() {strokes.push({style: this.strokeStyle, width: this.lineWidth, path: path.slice()});},
    arc(...args) {arcs.push(args);}, fill() {}, fillText(...args) {labels.push(args);}
  };
  return {width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({width, height}), strokes, arcs, labels};
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} vs ${b}`);

test('perspective camera is orthonormal and farther points really appear smaller', () => {
  for (const c of [camera, {azimuth: -72, elevation: 18}, {azimuth: 841, elevation: -62}]) {
    const basis = Object.values(View.cameraBasis(c));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(basis[i].reduce((sum, x, k) => sum + x * basis[j][k], 0), i === j ? 1 : 0);
  }
  const center = View.projectPoint([0, 0, 0], opts); near(center.x, 200); near(center.y, 200);
  const front = View.projectPoint([2, 1, 0], opts), back = View.projectPoint([-2, 1, 0], opts);
  assert.ok(front.x - 200 > back.x - 200); assert.ok(front.depth < back.depth);
  const rotated = View.projectPoint([2, 1, 0], {...opts, camera: {azimuth: 90, elevation: 0}});
  assert.notEqual(front.x, rotated.x);
  assert.equal(View.projectPoint([14, 0, 0], opts).visible, false);
});

test('9001 samples retain all 9000 original adjacent edges, with no depth-sort cross-connections', () => {
  const points = new Float64Array(9001 * 3);
  for (let i = 0; i < 9001; i++) {points[i * 3] = 2 * Math.sin(i * .017); points[i * 3 + 1] = 1.2 * Math.cos(i * .031); points[i * 3 + 2] = Math.sin(i * .043);}
  const original = points.slice(), canvas = mockCanvas(), result = View.draw(canvas, points, opts);
  assert.equal(result.count, 9001); assert.equal(result.segments, 9000); assert.equal(result.invalid, 0); assert.equal(result.clipped, 0); assert.deepEqual(points, original);
  const strokes = canvas.strokes.filter(s => s.style.startsWith('rgba('));
  assert.ok(strokes.length > 1 && strokes.length <= View.depthBuckets);
  const expected = new Set();
  const key = (a, b) => [a.x, a.y, b.x, b.y].map(x => x.toFixed(8)).join(',');
  for (let i = 1; i < 9001; i++) expected.add(key(View.projectPoint(points.subarray((i - 1) * 3, i * 3), opts), View.projectPoint(points.subarray(i * 3, i * 3 + 3), opts)));
  let edgeCount = 0;
  for (const stroke of strokes) for (let i = 0; i < stroke.path.length; i += 2) {
    const a = stroke.path[i], b = stroke.path[i + 1]; assert.equal(a[0], 'M'); assert.equal(b[0], 'L');
    assert.ok(expected.has([a[1], a[2], b[1], b[2]].map(x => x.toFixed(8)).join(',')));
    edgeCount++;
  }
  assert.equal(edgeCount, 9000); assert.deepEqual(canvas.labels.map(x => x[0]), ['X', 'Y', 'Z']);
  assert.ok(strokes[0].width < strokes.at(-1).width);
});

test('both views share world scale, fixed points remain points, invalid samples break edges', () => {
  const a = mockCanvas(), b = mockCanvas();
  const point = new Float64Array([0, 0, 0, 0, 0, 0]);
  View.draw(a, point, opts); View.draw(b, point, opts); assert.deepEqual(a.strokes, b.strokes);
  assert.equal(a.arcs[0][2], 2.4);
  const mixed = View.draw(mockCanvas(), [0, 0, 0, NaN, 1, 2, 0, 1, 0, 0, 2, 0], opts);
  assert.equal(mixed.invalid, 1); assert.equal(mixed.segments, 1); assert.equal(mixed.finite, 3);
  const clippedCanvas = mockCanvas();
  const clipped = View.draw(clippedCanvas, [13, 1, 0, 0, 1, 0], opts);
  assert.equal(clipped.nearClipped, 1); assert.equal(clipped.segments, 1);
  for (const stroke of clippedCanvas.strokes) for (const command of stroke.path) assert.ok(command.slice(1).every(Number.isFinite));
});

test('module supports browser global, empty views, null contexts, fixed high DPI backing size', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../assets/view3d.js'), 'utf8'), context);
  assert.equal(typeof context.TaoView3D.draw, 'function');
  assert.equal(View.draw({getContext: () => null}, [], opts).available, false);
  const canvas = mockCanvas(500, 300), empty = View.draw(canvas, null, {...opts, dpr: 3});
  assert.equal(empty.count, 0); assert.equal(canvas.width, 1000); assert.equal(canvas.height, 600);
  assert.throws(() => View.draw(mockCanvas(), [0, 0, 0], {...opts, projection: {center: [0, 0, 0], radius: 0}}), /共享中心/);
});
