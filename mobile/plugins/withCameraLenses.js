const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Expo exposes lens selection only on iOS and clamps Android zoom to >= 1x.
// Keep this Android adapter local and version-checked; never silently apply it
// to a changed upstream implementation. Only CameraX-exposed lenses are offered.
function replaceRequired(source, before, after) {
  if (!source.includes(before)) throw new Error('CalDone camera adapter: upstream source changed; review the patch');
  return source.replace(before, after);
}
function patchView(source) {
  if (source.includes('// CalDone Android lens adapter')) return source;
  source = replaceRequired(source, '  var zoom: Float = 0f', `  // CalDone Android lens adapter
  var selectedLens: String? = null
    set(value) {
      if (field != value) {
        field = value
        shouldCreateCamera = true
      }
    }

  @SuppressLint("UnsafeOptInUsageError")
  fun getAvailableLenses(): List<String> {
    val provider = cameraProvider ?: return emptyList()
    val candidates = CameraSelector.DEFAULT_BACK_CAMERA.filter(provider.availableCameraInfos)
    val primary = candidates.firstOrNull() ?: return emptyList()
    fun opticalScale(info: CameraInfo): Float {
      val camera2 = androidx.camera.camera2.interop.Camera2CameraInfo.from(info)
      val focal = camera2.getCameraCharacteristic(android.hardware.camera2.CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull() ?: return 1f
      val sensor = camera2.getCameraCharacteristic(android.hardware.camera2.CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)?.width ?: return focal
      return if (sensor > 0f) focal / sensor else 1f
    }
    val base = opticalScale(primary)
    return candidates.map { info ->
      val camera2 = androidx.camera.camera2.interop.Camera2CameraInfo.from(info)
      val state = info.zoomState.value
      org.json.JSONObject().apply {
        put("id", camera2.cameraId)
        put("scale", if (base > 0f) opticalScale(info) / base else 1f)
        put("min", state?.minZoomRatio ?: 1f)
        put("max", state?.maxZoomRatio ?: 1f)
        put("primary", info == primary)
      }.toString()
    }
  }

  var zoom: Float = 0f`);
  source = replaceRequired(source, '.requireLensFacing(lensFacing.mapToCharacteristic())\n      .build()', `.requireLensFacing(lensFacing.mapToCharacteristic())
      .apply {
        selectedLens?.let { id ->
          addCameraFilter { infos -> infos.filter { androidx.camera.camera2.interop.Camera2CameraInfo.from(it).cameraId == id } }
        }
      }
      .build()`);
  source = replaceRequired(source, 'val targetZoomRatio = max(1f, min(maxZoomRatio, value.coerceIn(0f, 1f) * maxZoomRatio))', 'val minZoomRatio = camera?.cameraInfo?.zoomState?.value?.minZoomRatio ?: 1f\n    val targetZoomRatio = max(minZoomRatio, min(maxZoomRatio, value.coerceIn(0f, 1f) * maxZoomRatio))');
  return source;
}
function patchModule(source) {
  if (source.includes('// CalDone Android lens adapter')) return source;
  return replaceRequired(source, '      Prop("zoom")', `      // CalDone Android lens adapter
      Prop("selectedLens") { view, lens: String? -> view.selectedLens = lens }
      AsyncFunction("getAvailableLenses") { view: ExpoCameraView -> view.getAvailableLenses() }.runOnQueue(Queues.MAIN)

      Prop("zoom")`);
}
module.exports = function withCameraLenses(config) {
  return withDangerousMod(config, ['android', async mod => {
    const root = path.dirname(require.resolve('expo-camera/package.json'));
    const directory = path.join(root, 'android/src/main/java/expo/modules/camera');
    for (const [name, patch] of [['ExpoCameraView.kt', patchView], ['CameraViewModule.kt', patchModule]]) {
      const filename = path.join(directory, name);
      await fs.writeFile(filename, patch(await fs.readFile(filename, 'utf8')));
    }
    return mod;
  }]);
};
module.exports.patchView = patchView;
module.exports.patchModule = patchModule;
