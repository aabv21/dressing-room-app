// NOTE: not compiled or run yet — this Mac has no JDK or Android SDK; ceiling: Android cut-out is
// unverified, upgrade path: compile and test garment-cutout on Android in the owner session
// (listed in AGENTS.md).
package expo.modules.garmentcutout

import android.graphics.Bitmap
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class GarmentCutoutModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("GarmentCutout")

    Function("isAvailable") {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
        ConnectionResult.SUCCESS
    }

    // Runs on the module's background queue, so blocking on the ML Kit task is fine here.
    AsyncFunction("cutOut") { uri: String ->
      val options = SubjectSegmenterOptions.Builder().enableForegroundBitmap().build()
      val segmenter = SubjectSegmentation.getClient(options)
      try {
        // fromFilePath applies the EXIF rotation.
        val image = InputImage.fromFilePath(context, Uri.parse(uri))
        val result = Tasks.await(segmenter.process(image))
        val foreground = result.foregroundBitmap ?: return@AsyncFunction null
        val subject = cropToSubject(foreground) ?: return@AsyncFunction null
        writePng(subject)
      } catch (e: CodedException) {
        throw e
      } catch (e: Exception) {
        throw CutOutFailedException(e)
      } finally {
        segmenter.close()
      }
    }
  }

  // foregroundBitmap keeps the source size with a transparent background; crop to the opaque
  // pixels so the PNG matches iOS's croppedToInstancesExtent output. Null when nothing is opaque.
  private fun cropToSubject(bitmap: Bitmap): Bitmap? {
    val width = bitmap.width
    val height = bitmap.height
    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    var left = width
    var top = height
    var right = -1
    var bottom = -1
    for (y in 0 until height) {
      val row = y * width
      for (x in 0 until width) {
        if (pixels[row + x] ushr 24 != 0) {
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
    }
    if (right < 0) return null
    return Bitmap.createBitmap(bitmap, left, top, right - left + 1, bottom - top + 1)
  }

  private fun writePng(bitmap: Bitmap): String {
    val directory = File(appContext.cacheDirectory, "garment-cutout").apply { mkdirs() }
    val file = File(directory, "${UUID.randomUUID()}.png")
    FileOutputStream(file).use { stream ->
      if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
        throw CodedException("Could not write the cut-out PNG")
      }
    }
    return Uri.fromFile(file).toString()
  }
}

private class CutOutFailedException(cause: Throwable) :
  CodedException("Garment cut-out failed: ${cause.message}", cause)
