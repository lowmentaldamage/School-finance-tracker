package com.keel.finance

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import androidx.core.app.NotificationManagerCompat
import androidx.documentfile.provider.DocumentFile
import app.tauri.PermissionState
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import androidx.activity.result.ActivityResult
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class DataArgs {
    var data: String = ""
}

@InvokeArg
class PromptArgs {
    var data: String = ""
    var title: String = "Unlock Keel"
    var cancel: String = "Use PIN"
}

@InvokeArg
class SaveArgs {
    var name: String = "keel-export"
    var mime: String = "application/octet-stream"
    var data: String = ""
}

@InvokeArg
class SecureArgs {
    var enabled: Boolean = false
}

@InvokeArg
class FolderArgs {
    var uri: String = ""
    var name: String = ""
    var mime: String = "application/octet-stream"
    var data: String = ""
}

@InvokeArg
class RemindersArgs {
    /** JSON array of {id, at, title, body}. */
    var items: String = "[]"
}

@InvokeArg
class ReminderArgs {
    var id: Int = 0
    var title: String = ""
    var body: String = ""
}

@InvokeArg
class HttpArgs {
    var url: String = ""
    var method: String = "POST"
    /** JSON object of header name → value. */
    var headers: String = "{}"
    var body: String = ""
}

@InvokeArg
class UrlArgs {
    var url: String = ""
}

/**
 * Native services for Keel, called from Rust only (never exposed to the web view directly):
 * - wrap/unwrap: protect the database key with a non-exportable AES-256-GCM Android Keystore key.
 * - bio*: the same with a key that can only be used after a strong biometric check.
 * - saveFile/openFile: the system file picker (Storage Access Framework); no storage permission needed.
 * - setSecure: hide app content in the recent-apps switcher and block screenshots.
 */
@TauriPlugin(
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")]
)
class KeelPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        /** Dropbox sign-in redirect waiting to be picked up by the web view. */
        @Volatile
        var pendingRedirect: String? = null

        private val NETWORK_HOSTS = setOf("api.dropboxapi.com", "content.dropboxapi.com")
        private const val AUTH_PREFIX = "https://www.dropbox.com/oauth2/authorize?"
    }

    override fun load(webView: WebView) {
        captureRedirect(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        captureRedirect(intent)
    }

    private fun captureRedirect(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme?.startsWith("db-") == true && data.host == "auth") pendingRedirect = data.toString()
    }

    private val deviceAlias = "keel_dek_wrap_v1"
    private val bioAlias = "keel_bio_wrap_v1"
    private val ivBytes = 12
    private val tagBits = 128
    private val maxFileBytes = 200L * 1024 * 1024

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun deviceKey(): SecretKey {
        (keyStore().getEntry(deviceAlias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(deviceAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun bioKey(create: Boolean): SecretKey? {
        (keyStore().getEntry(bioAlias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        if (!create) return null
        val spec = KeyGenParameterSpec.Builder(bioAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(spec.build())
        return gen.generateKey()
    }

    private fun result(bytes: ByteArray): JSObject {
        val ret = JSObject()
        ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
        return ret
    }

    private fun join(iv: ByteArray, ct: ByteArray): ByteArray {
        val out = ByteArray(iv.size + ct.size)
        System.arraycopy(iv, 0, out, 0, iv.size)
        System.arraycopy(ct, 0, out, iv.size, ct.size)
        return out
    }

    @Command
    fun wrap(invoke: Invoke) {
        try {
            val plain = Base64.decode(invoke.parseArgs(DataArgs::class.java).data, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, deviceKey())
            val out = join(cipher.iv, cipher.doFinal(plain))
            plain.fill(0)
            invoke.resolve(result(out))
        } catch (e: Exception) {
            invoke.reject("keystore wrap failed")
        }
    }

    @Command
    fun unwrap(invoke: Invoke) {
        try {
            val blob = Base64.decode(invoke.parseArgs(DataArgs::class.java).data, Base64.NO_WRAP)
            if (blob.size <= ivBytes) throw IllegalArgumentException("short")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, deviceKey(), GCMParameterSpec(tagBits, blob.copyOfRange(0, ivBytes)))
            val plain = cipher.doFinal(blob.copyOfRange(ivBytes, blob.size))
            invoke.resolve(result(plain))
            plain.fill(0)
        } catch (e: Exception) {
            invoke.reject("keystore unwrap failed")
        }
    }

    @Command
    fun bioStatus(invoke: Invoke) {
        val ok = BiometricManager.from(activity).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
        val ret = JSObject()
        ret.put("available", ok)
        invoke.resolve(ret)
    }

    private fun prompt(invoke: Invoke, args: PromptArgs, cipher: Cipher, onOk: (Cipher) -> ByteArray) {
        val fa = activity as? FragmentActivity
        if (fa == null) {
            invoke.reject("biometric unavailable")
            return
        }
        fa.runOnUiThread {
            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) {
                    try {
                        val c = r.cryptoObject?.cipher ?: throw IllegalStateException("no cipher")
                        val out = onOk(c)
                        invoke.resolve(result(out))
                        out.fill(0)
                    } catch (e: Exception) {
                        invoke.reject("biometric operation failed")
                    }
                }

                override fun onAuthenticationError(code: Int, msg: CharSequence) {
                    invoke.reject("biometric cancelled")
                }
            }
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(args.title)
                .setNegativeButtonText(args.cancel)
                .setAllowedAuthenticators(BIOMETRIC_STRONG)
                .build()
            BiometricPrompt(fa, ContextCompat.getMainExecutor(fa), callback).authenticate(info, BiometricPrompt.CryptoObject(cipher))
        }
    }

    @Command
    fun bioWrap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PromptArgs::class.java)
            val plain = Base64.decode(args.data, Base64.NO_WRAP)
            // A new enrolment-bound key each time biometrics are turned on.
            keyStore().deleteEntry(bioAlias)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, bioKey(true))
            prompt(invoke, args, cipher) { c ->
                val out = join(c.iv, c.doFinal(plain))
                plain.fill(0)
                out
            }
        } catch (e: Exception) {
            invoke.reject("biometric setup failed")
        }
    }

    @Command
    fun bioUnwrap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PromptArgs::class.java)
            val blob = Base64.decode(args.data, Base64.NO_WRAP)
            if (blob.size <= ivBytes) throw IllegalArgumentException("short")
            val key = bioKey(false) ?: throw IllegalStateException("no key")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(tagBits, blob.copyOfRange(0, ivBytes)))
            prompt(invoke, args, cipher) { c -> c.doFinal(blob.copyOfRange(ivBytes, blob.size)) }
        } catch (e: KeyPermanentlyInvalidatedException) {
            invoke.reject("biometric key invalidated")
        } catch (e: Exception) {
            invoke.reject("biometric unlock failed")
        }
    }

    @Command
    fun saveFile(invoke: Invoke) {
        val args = invoke.parseArgs(SaveArgs::class.java)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = args.mime
            putExtra(Intent.EXTRA_TITLE, args.name)
        }
        startActivityForResult(invoke, intent, "saveFileResult")
    }

    @ActivityCallback
    fun saveFileResult(invoke: Invoke, result: ActivityResult) {
        val ret = JSObject()
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            ret.put("saved", false)
            invoke.resolve(ret)
            return
        }
        try {
            val bytes = Base64.decode(invoke.parseArgs(SaveArgs::class.java).data, Base64.NO_WRAP)
            activity.contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } ?: throw IllegalStateException("no stream")
            ret.put("saved", true)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject("could not write the file")
        }
    }

    @Command
    fun openFile(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(invoke, intent, "openFileResult")
    }

    @ActivityCallback
    fun openFileResult(invoke: Invoke, result: ActivityResult) {
        val ret = JSObject()
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            ret.put("data", "")
            invoke.resolve(ret)
            return
        }
        try {
            val out = ByteArrayOutputStream()
            activity.contentResolver.openInputStream(uri)?.use { input ->
                val buf = ByteArray(64 * 1024)
                var total = 0L
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    total += n
                    if (total > maxFileBytes) throw IllegalStateException("too large")
                    out.write(buf, 0, n)
                }
            } ?: throw IllegalStateException("no stream")
            invoke.resolve(result(out.toByteArray()))
        } catch (e: Exception) {
            invoke.reject("could not read the file")
        }
    }

    @Command
    fun setSecure(invoke: Invoke) {
        val enabled = invoke.parseArgs(SecureArgs::class.java).enabled
        activity.runOnUiThread {
            if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            invoke.resolve()
        }
    }

    // ---- Folder access (automatic backups) via the Storage Access Framework ----

    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        )
        startActivityForResult(invoke, intent, "pickFolderResult")
    }

    @ActivityCallback
    fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(obj("uri" to ""))
            return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            val name = DocumentFile.fromTreeUri(activity, uri)?.name ?: "Folder"
            invoke.resolve(obj("uri" to uri.toString(), "name" to name))
        } catch (e: Exception) {
            invoke.reject("could not use this folder")
        }
    }

    private fun tree(uri: String): DocumentFile {
        if (!uri.startsWith("content://")) throw IllegalArgumentException("bad uri")
        return DocumentFile.fromTreeUri(activity, Uri.parse(uri)) ?: throw IllegalStateException("no folder")
    }

    private fun safeName(name: String): String {
        if (!Regex("^keel-[A-Za-z0-9._-]{1,80}$").matches(name)) throw IllegalArgumentException("bad name")
        return name
    }

    @Command
    fun writeToFolder(invoke: Invoke) {
        Thread {
            try {
                val a = invoke.parseArgs(FolderArgs::class.java)
                val dir = tree(a.uri)
                val name = safeName(a.name)
                val file = dir.findFile(name) ?: dir.createFile(a.mime, name) ?: throw IllegalStateException("create failed")
                val bytes = Base64.decode(a.data, Base64.NO_WRAP)
                activity.contentResolver.openOutputStream(file.uri, "wt")?.use { it.write(bytes) } ?: throw IllegalStateException("no stream")
                invoke.resolve(obj("name" to file.name))
            } catch (e: Exception) {
                invoke.reject("could not write to the backup folder")
            }
        }.start()
    }

    @Command
    fun listFolder(invoke: Invoke) {
        try {
            val a = invoke.parseArgs(FolderArgs::class.java)
            val arr = JSONArray()
            for (f in tree(a.uri).listFiles()) {
                val n = f.name ?: continue
                if (f.isFile && n.startsWith("keel-")) arr.put(JSONObject().put("name", n).put("modified", f.lastModified()))
            }
            invoke.resolve(obj("files" to arr.toString()))
        } catch (e: Exception) {
            invoke.reject("could not read the backup folder")
        }
    }

    @Command
    fun deleteInFolder(invoke: Invoke) {
        try {
            val a = invoke.parseArgs(FolderArgs::class.java)
            tree(a.uri).findFile(safeName(a.name))?.delete()
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("could not delete the old backup")
        }
    }

    // ---- Reminders ----

    @Command
    fun notifyPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            invoke.resolve(obj("granted" to NotificationManagerCompat.from(activity).areNotificationsEnabled()))
        } else {
            requestPermissionForAlias("notifications", invoke, "notifyPermissionResult")
        }
    }

    @PermissionCallback
    fun notifyPermissionResult(invoke: Invoke) {
        invoke.resolve(obj("granted" to (getPermissionState("notifications") == PermissionState.GRANTED)))
    }

    @Command
    fun scheduleReminders(invoke: Invoke) {
        try {
            Reminders.ensureChannel(activity)
            Reminders.schedule(activity, JSONArray(invoke.parseArgs(RemindersArgs::class.java).items))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("could not schedule reminders")
        }
    }

    @Command
    fun showReminder(invoke: Invoke) {
        val a = invoke.parseArgs(ReminderArgs::class.java)
        Reminders.show(activity, a.id, a.title, a.body)
        invoke.resolve()
    }

    // ---- Dropbox (the only network access Keel has) ----

    @Command
    fun openUrl(invoke: Invoke) {
        val url = invoke.parseArgs(UrlArgs::class.java).url
        if (!url.startsWith(AUTH_PREFIX)) {
            invoke.reject("blocked")
            return
        }
        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        invoke.resolve()
    }

    @Command
    fun takeAuthRedirect(invoke: Invoke) {
        val r = pendingRedirect
        pendingRedirect = null
        invoke.resolve(obj("url" to (r ?: "")))
    }

    @Command
    fun httpRequest(invoke: Invoke) {
        Thread {
            try {
                val a = invoke.parseArgs(HttpArgs::class.java)
                val url = URL(a.url)
                if (url.protocol != "https" || url.host !in NETWORK_HOSTS) throw SecurityException("host not allowed")
                val c = url.openConnection() as HttpURLConnection
                c.requestMethod = a.method
                c.connectTimeout = 15000
                c.readTimeout = 60000
                val headers = JSONObject(a.headers)
                for (k in headers.keys()) c.setRequestProperty(k, headers.getString(k))
                if (a.body.isNotEmpty() || a.method == "POST") {
                    c.doOutput = true
                    val bytes = Base64.decode(a.body, Base64.NO_WRAP)
                    c.outputStream.use { it.write(bytes) }
                }
                val status = c.responseCode
                val stream = if (status >= 400) c.errorStream else c.inputStream
                val body = stream?.use { it.readBytes() } ?: ByteArray(0)
                val ret = JSObject()
                ret.put("status", status)
                ret.put("body", Base64.encodeToString(body, Base64.NO_WRAP))
                ret.put("api_result", c.getHeaderField("Dropbox-API-Result") ?: "")
                invoke.resolve(ret)
            } catch (e: SecurityException) {
                invoke.reject("blocked")
            } catch (e: Exception) {
                invoke.reject("network error")
            }
        }.start()
    }
}

private fun obj(vararg pairs: Pair<String, Any?>): JSObject {
    val o = JSObject()
    for ((k, v) in pairs) o.put(k, v)
    return o
}
