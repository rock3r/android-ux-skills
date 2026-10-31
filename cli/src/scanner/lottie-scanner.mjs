/**
 * Lottie `.json` analyzer for O-002 (reduced-motion end-frame rest state).
 *
 * Recognizes all 4 case-insensitive marker names from Lottie's `reducedMotion` spec:
 * - `reduced motion`
 * - `reduced_motion`
 * - `reduced-motion`
 * - `reducedmotion`
 *
 * Evaluates top-level layers at composition `op` (end frame) and frame `ip` (start frame,
 * for reverse playback consumers) to determine whether all visible layers end blank/invisible,
 * distinguishing simple single-composition assets from complex precomp/matte/time-remap assets.
 */

const REDUCED_MOTION_MARKERS = new Set([
  'reduced motion',
  'reduced_motion',
  'reduced-motion',
  'reducedmotion',
]);

export function isLottieJsonObject(parsed) {
  return Boolean(
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof parsed.v === 'string' &&
    typeof parsed.fr === 'number' &&
    typeof parsed.ip === 'number' &&
    typeof parsed.op === 'number' &&
    Array.isArray(parsed.layers)
  );
}

export function analyzeLottieJson(content, filePath = '<lottie.json>') {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { isLottie: false, parseError: true };
  }

  if (!isLottieJsonObject(parsed)) {
    return { isLottie: false };
  }

  const lineCount = Math.max(1, String(content).replace(/\r\n/g, '\n').split('\n').length - (String(content).endsWith('\n') ? 1 : 0));
  const ip = typeof parsed.ip === 'number' ? parsed.ip : 0;
  const op = parsed.op;

  const markers = Array.isArray(parsed.markers) ? parsed.markers : [];
  const reducedMotionMarker = markers.find((m) => {
    const cm = String(m?.cm || '').trim().toLowerCase();
    return REDUCED_MOTION_MARKERS.has(cm);
  }) || null;

  const layers = parsed.layers.filter((l) => l && typeof l === 'object' && l.hd !== true);
  const hasAssetsPrecomps = Array.isArray(parsed.assets) && parsed.assets.some((a) => Array.isArray(a?.layers) && a.layers.length > 0);
  const hasComplexFeatures =
    hasAssetsPrecomps ||
    layers.some((l) =>
      l.ty === 0 || // precomp layer
      Boolean(l.refId) ||
      l.tt !== undefined || // track matte
      l.td !== undefined ||
      l.tm !== undefined || // time remap
      l.parent !== undefined || // parented transform hierarchy
      (Array.isArray(l.masksProperties) && l.masksProperties.length > 0) ||
      (typeof l.st === 'number' && l.st !== 0) ||
      (typeof l.sr === 'number' && l.sr !== 1)
    );

  const endLayerStates = layers.map((layer) => evaluateLayerVisibilityAtFrame(layer, op));
  const startLayerStates = layers.map((layer) => evaluateLayerVisibilityAtFrame(layer, ip));

  const allBlankAtEnd =
    layers.length > 0 &&
    endLayerStates.every((st) => st.status === 'invisible');
  const anyUnknownAtEnd = endLayerStates.some((st) => st.status === 'unknown');

  const allBlankAtStart =
    layers.length > 0 &&
    startLayerStates.every((st) => st.status === 'invisible');

  return {
    isLottie: true,
    filePath,
    lineCount,
    assetBaseName: extractAssetBaseName(filePath),
    ip,
    op,
    hasReducedMotionMarker: Boolean(reducedMotionMarker),
    reducedMotionMarkerName: reducedMotionMarker ? String(reducedMotionMarker.cm).trim() : null,
    hasComplexFeatures,
    layerCount: layers.length,
    endLayerStates,
    allBlankAtEnd,
    allBlankAtStart,
    anyUnknownAtEnd,
  };
}

function extractAssetBaseName(filePath) {
  const norm = String(filePath).replace(/\\/g, '/');
  const base = norm.split('/').pop() || '';
  return base.replace(/\.json$/i, '');
}

/**
 * Evaluate a single Lottie layer's opacity/lifetime visibility at `frame`.
 */
function evaluateLayerVisibilityAtFrame(layer, frame) {
  const layerLabel = layer.nm || (layer.ind !== undefined ? `layer#${layer.ind}` : 'unnamed-layer');
  const lIp = typeof layer.ip === 'number' ? layer.ip : -Infinity;
  const lOp = typeof layer.op === 'number' ? layer.op : Infinity;

  // In Lottie, `op` is the exclusive out-point; at composition `op`, a layer whose `layer.op < frame`
  // has already ended before the final rest frame. (A layer with `layer.op === frame` spans up to the end.)
  if (frame < lIp || lOp < frame) {
    return { layer: layerLabel, status: 'invisible', reason: `outside layer range [${lIp}, ${lOp})` };
  }

  const oProp = layer?.ks?.o;
  if (!oProp || typeof oProp !== 'object') {
    return { layer: layerLabel, status: 'visible', opacity: 100 };
  }

  // Expression on opacity (`x` string) makes static evaluation ambiguous
  if (typeof oProp.x === 'string' && oProp.x.trim().length > 0) {
    return { layer: layerLabel, status: 'unknown', reason: 'opacity expression' };
  }

  // Non-animated opacity (`a === 0` or numeric `k`)
  if (oProp.a !== 1) {
    const val = Array.isArray(oProp.k) ? Number(oProp.k[0]) : Number(oProp.k);
    if (!Number.isFinite(val)) return { layer: layerLabel, status: 'unknown', reason: 'non-numeric opacity' };
    return val <= 0
      ? { layer: layerLabel, status: 'invisible', opacity: val, reason: 'static opacity 0' }
      : { layer: layerLabel, status: 'visible', opacity: val };
  }

  // Animated keyframes (`a === 1`, `k` is array of keyframe objects)
  if (!Array.isArray(oProp.k) || oProp.k.length === 0) {
    return { layer: layerLabel, status: 'unknown', reason: 'empty keyframe array' };
  }

  const kfs = oProp.k
    .filter((kf) => kf && typeof kf === 'object' && typeof kf.t === 'number')
    .sort((a, b) => a.t - b.t);

  if (kfs.length === 0) {
    return { layer: layerLabel, status: 'unknown', reason: 'unparseable keyframes' };
  }

  const opacity = sampleKeyframesAt(kfs, frame);
  if (opacity === null || !Number.isFinite(opacity)) {
    return { layer: layerLabel, status: 'unknown', reason: 'ambiguous keyframe value' };
  }

  return opacity <= 0
    ? { layer: layerLabel, status: 'invisible', opacity, reason: `keyframe opacity ${opacity} at frame ${frame}` }
    : { layer: layerLabel, status: 'visible', opacity };
}

function extractScalar(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'number') return v[0];
  return null;
}

function sampleKeyframesAt(kfs, frame) {
  if (frame <= kfs[0].t) {
    return extractScalar(kfs[0].s);
  }
  const last = kfs[kfs.length - 1];
  if (frame >= last.t) {
    const sVal = extractScalar(last.s);
    if (sVal !== null) return sVal;
    // Older Lottie format stores terminal value in `e` of second-to-last keyframe
    if (kfs.length >= 2) {
      return extractScalar(kfs[kfs.length - 2].e);
    }
    return null;
  }

  for (let i = 0; i < kfs.length - 1; i += 1) {
    const cur = kfs[i];
    const next = kfs[i + 1];
    if (frame >= cur.t && frame <= next.t) {
      const startVal = extractScalar(cur.s);
      if (cur.h === 1) return startVal; // hold keyframe
      const endVal = extractScalar(next.s) ?? extractScalar(cur.e);
      if (startVal === null || endVal === null) return null;
      if (next.t === cur.t) return endVal;
      const ratio = (frame - cur.t) / (next.t - cur.t);
      return startVal + (endVal - startVal) * ratio;
    }
  }
  return null;
}
