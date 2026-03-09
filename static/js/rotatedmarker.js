// Minimal Leaflet.RotatedMarker (no external deps)
// Adds: marker.setRotationAngle(deg) and marker.setRotationOrigin(css)
(function () {
  if (!window.L || !L.Marker) return;

  const proto = L.Marker.prototype;

  function applyRotation(marker) {
    if (!marker._icon) return;
    const angle = marker.options.rotationAngle || 0;
    const origin = marker.options.rotationOrigin || 'center center';
    marker._icon.style.transformOrigin = origin;

    // Keep existing transforms (Leaflet uses translate3d)
    const tr = marker._icon.style.transform || '';
    const cleaned = tr.replace(/\s*rotate\([^)]*\)/g, '').trim();
    marker._icon.style.transform = (cleaned ? cleaned + ' ' : '') + 'rotate(' + angle + 'deg)';
  }

  const _setPos = proto._setPos;
  proto._setPos = function (pos) {
    _setPos.call(this, pos);
    applyRotation(this);
  };

  proto.setRotationAngle = function (angle) {
    this.options.rotationAngle = angle;
    applyRotation(this);
    return this;
  };

  proto.setRotationOrigin = function (origin) {
    this.options.rotationOrigin = origin;
    applyRotation(this);
    return this;
  };
})();
