// NOTE: not compiled or run yet — this Mac has no JDK or Android SDK; ceiling: Android cut-out is
// unverified, upgrade path: compile and test garment-cutout on Android in the owner session
// (listed in AGENTS.md).
package expo.modules.garmentcutout

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
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

// A 48 MP photo would need ~192 MB per ARGB bitmap; the upload pipeline resizes to 784 px anyway.
private const val MAX_SOURCE_SIDE = 2048

class GarmentCutoutModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val segmenterOptions
    get() = SubjectSegmenterOptions.Builder().enableForegroundBitmap().build()

  override fun definition() = ModuleDefinition {
    Name("GarmentCutout")

    Function("isAvailable") {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
        ConnectionResult.SUCCESS
    }

    // Runs on the module's background queue, so blocking on the Play services tasks is fine here.
    AsyncFunction("cutOut") { uri: String ->
      val segmenter = SubjectSegmentation.getClient(segmenterOptions)
      try {
        val moduleInstall = ModuleInstall.getClient(context)
        if (!Tasks.await(moduleInstall.areModulesAvailable(segmenter)).areModulesAvailable()) {
          // The manifest's install-time download hasn't finished (or was skipped): ask for it again
          // without waiting, on a client of its own that outlives this call, and keep the original
          // photo this time.
          moduleInstall.installModules(
            ModuleInstallRequest.newBuilder()
              .addApi(SubjectSegmentation.getClient(segmenterOptions))
              .build()
          )
          return@AsyncFunction null
        }
        val source = decodeCapped(Uri.parse(uri))
        val result = Tasks.await(segmenter.process(InputImage.fromBitmap(source, 0)))
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

  // Decodes at most MAX_SOURCE_SIDE px on the longest side (power-of-two sampling, never upscaled)
  // and applies the EXIF orientation, so the bitmap is upright.
  private fun decodeCapped(uri: Uri): Bitmap {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    // With inJustDecodeBounds, decodeStream returns null and only fills `bounds`.
    val stream = resolver.openInputStream(uri) ?: throw CodedException("Could not open the image at $uri")
    stream.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) throw CodedException("Could not read the image at $uri")

    var sampleSize = 1
    while (longest / sampleSize > MAX_SOURCE_SIDE) sampleSize *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
      ?: throw CodedException("Could not read the image at $uri")

    val orientation = resolver.openInputStream(uri)?.use {
      ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    } ?: ExifInterface.ORIENTATION_NORMAL
    val matrix = exifMatrix(orientation) ?: return decoded
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (upright !== decoded) decoded.recycle()
    return upright
  }

  private fun exifMatrix(orientation: Int): Matrix? = when (orientation) {
    ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> Matrix().apply { setScale(-1f, 1f) }
    ExifInterface.ORIENTATION_ROTATE_180 -> Matrix().apply { setRotate(180f) }
    ExifInterface.ORIENTATION_FLIP_VERTICAL -> Matrix().apply { setScale(1f, -1f) }
    ExifInterface.ORIENTATION_TRANSPOSE -> Matrix().apply { setRotate(90f); postScale(-1f, 1f) }
    ExifInterface.ORIENTATION_ROTATE_90 -> Matrix().apply { setRotate(90f) }
    ExifInterface.ORIENTATION_TRANSVERSE -> Matrix().apply { setRotate(-90f); postScale(-1f, 1f) }
    ExifInterface.ORIENTATION_ROTATE_270 -> Matrix().apply { setRotate(-90f) }
    else -> null
  }

  // foregroundBitmap keeps the source size with a transparent background; crop to the opaque
  // pixels so the PNG matches iOS's croppedToInstancesExtent output. Scans one row at a time to
  // keep memory flat. Null when nothing is opaque.
  private fun cropToSubject(bitmap: Bitmap): Bitmap? {
    val width = bitmap.width
    val height = bitmap.height
    val row = IntArray(width)
    var left = width
    var top = height
    var right = -1
    var bottom = -1
    for (y in 0 until height) {
      bitmap.getPixels(row, 0, width, 0, y, width, 1)
      for (x in 0 until width) {
        if (row[x] ushr 24 != 0) {
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          bottom = y
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
