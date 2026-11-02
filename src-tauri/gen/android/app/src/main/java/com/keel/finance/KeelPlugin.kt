package com.keel.finance

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class DataArgs {
    var data: String = ""
}

/**
 * Native services for Keel. Called from Rust only (not exposed to the web view).
 *
 * wrap/unwrap: protect the database key with a non-exportable AES-256-GCM key held in the
 * Android Keystore (hardware-backed on devices with a TEE or StrongBox).
 */
@TauriPlugin
class KeelPlugin(private val activity: Activity) : Plugin(activity) {

    private val alias = "keel_dek_wrap_v1"
    private val gcmIvBytes = 12
    private val gcmTagBits = 128

    private fun wrappingKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    @Command
    fun wrap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(DataArgs::class.java)
            val plain = Base64.decode(args.data, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
            val iv = cipher.iv
            val ct = cipher.doFinal(plain)
            plain.fill(0)
            val out = ByteArray(iv.size + ct.size)
            System.arraycopy(iv, 0, out, 0, iv.size)
            System.arraycopy(ct, 0, out, iv.size, ct.size)
            val ret = JSObject()
            ret.put("data", Base64.encodeToString(out, Base64.NO_WRAP))
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject("keystore wrap failed")
        }
    }

    @Command
    fun unwrap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(DataArgs::class.java)
            val blob = Base64.decode(args.data, Base64.NO_WRAP)
            if (blob.size <= gcmIvBytes) throw IllegalArgumentException("short")
            val iv = blob.copyOfRange(0, gcmIvBytes)
            val ct = blob.copyOfRange(gcmIvBytes, blob.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(gcmTagBits, iv))
            val plain = cipher.doFinal(ct)
            val ret = JSObject()
            ret.put("data", Base64.encodeToString(plain, Base64.NO_WRAP))
            plain.fill(0)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject("keystore unwrap failed")
        }
    }
}
