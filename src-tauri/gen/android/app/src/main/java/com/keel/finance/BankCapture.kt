package com.keel.finance

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Reads notifications from the bank apps the user picked and queues them for Keel.
 *
 * - Only apps on the user's list are read; for other apps only the app name is remembered, and
 *   only when a notification looks like a payment (so the user can pick it later).
 * - Queued text is encrypted with a non-exportable Android Keystore key, because the listener
 *   runs while Keel is locked or closed and cannot write to the encrypted database.
 * - Keel reads and empties the queue once it is unlocked; the core does all interpretation.
 */
object BankCapture {
    private const val PREFS = "keel_capture"
    private const val QUEUE = "capture.queue"
    private const val KEY_ALIAS = "keel_capture_v1"
    private const val MAX_QUEUE = 500
    private const val MAX_SEEN = 40

    /** A currency next to a number, e.g. "€12.50", "12,50 EUR", "$5", "45 zł". */
    private val MONEY = Regex(
        "(?:[€£$¥₹₺₽₩₪₴]|\\b[A-Z]{3}\\b|zł|kr|Kč|Ft|lei|R\\$)\\s?[-+]?\\d|\\d(?:[\\d.,'\\u00a0 ]*\\d)?\\s?(?:[€£$¥₹₺₽₩₪₴]|\\b[A-Z]{3}\\b|zł|kr|Kč|Ft|lei)"
    )

    private val lock = Any()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(ctx: Context) = prefs(ctx).getBoolean("enabled", false)

    fun packages(ctx: Context): Set<String> = prefs(ctx).getStringSet("packages", emptySet()) ?: emptySet()

    fun configure(ctx: Context, enabled: Boolean, packages: List<String>) {
        prefs(ctx).edit()
            .putBoolean("enabled", enabled)
            .putStringSet("packages", packages.filter { Regex("^[A-Za-z0-9._]{1,200}$").matches(it) }.toSet())
            .apply()
        if (!enabled) synchronized(lock) { File(ctx.filesDir, QUEUE).delete() }
    }

    fun hasAccess(ctx: Context): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

    /** Apps that posted payment-like notifications, newest first: [{package, label}]. */
    fun seen(ctx: Context): JSONArray {
        val raw = prefs(ctx).getString("seen", "[]") ?: "[]"
        return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
    }

    private fun remember(ctx: Context, pkg: String) {
        val arr = seen(ctx)
        val out = JSONArray()
        out.put(JSONObject().put("package", pkg).put("label", label(ctx, pkg)))
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("package") != pkg && out.length() < MAX_SEEN) out.put(o)
        }
        prefs(ctx).edit().putString("seen", out.toString()).apply()
    }

    /** Bank apps read without picking them first (Revolut, NLB Klik). */
    private val KNOWN_BANKS = Regex("(?i)revolut|\\bnlb\\b|nlb ?klik")

    fun isKnownBank(ctx: Context, pkg: String): Boolean =
        KNOWN_BANKS.containsMatchIn(pkg) || KNOWN_BANKS.containsMatchIn(label(ctx, pkg))

    fun label(ctx: Context, pkg: String): String = try {
        val pm = ctx.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        pkg
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun seal(plain: ByteArray): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val ct = c.doFinal(plain)
        return Base64.encodeToString(c.iv + ct, Base64.NO_WRAP)
    }

    private fun open(line: String): ByteArray {
        val blob = Base64.decode(line, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob.copyOfRange(0, 12)))
        return c.doFinal(blob.copyOfRange(12, blob.size))
    }

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    fun onPosted(ctx: Context, sbn: StatusBarNotification) {
        if (sbn.packageName == ctx.packageName || !enabled(ctx)) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val extras = n.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString().orEmpty()
        val all = "$title\n$text"
        if (!MONEY.containsMatchIn(all)) return
        val pkg = sbn.packageName
        if (pkg !in packages(ctx) && !isKnownBank(ctx, pkg)) {
            remember(ctx, pkg)
            return
        }
        if (pkg !in packages(ctx)) remember(ctx, pkg)
        val item = JSONObject()
            .put("key", sha256("$pkg|${sbn.key}|$title|$text"))
            .put("package", pkg)
            .put("app", label(ctx, pkg))
            .put("title", title.take(300))
            .put("text", text.take(1000))
            .put("posted_ms", sbn.postTime)
        synchronized(lock) {
            val f = File(ctx.filesDir, QUEUE)
            val lines = if (f.exists()) f.readLines().filter { it.isNotBlank() } else emptyList()
            val keep = lines.takeLast(MAX_QUEUE - 1) + seal(item.toString().toByteArray())
            f.writeText(keep.joinToString("\n") + "\n")
        }
    }

    /** Decrypt the queue without removing it; returns (items, lines read). */
    fun peek(ctx: Context): Pair<JSONArray, Int> {
        val out = JSONArray()
        synchronized(lock) {
            val f = File(ctx.filesDir, QUEUE)
            if (!f.exists()) return Pair(out, 0)
            val lines = f.readLines().filter { it.isNotBlank() }
            for (line in lines) {
                try {
                    out.put(JSONObject(String(open(line))))
                } catch (e: Exception) {
                    // Unreadable entry (e.g. the key was reset): skipped and removed on ack.
                }
            }
            return Pair(out, lines.size)
        }
    }

    /** Remove the first `count` lines once Keel has stored them. */
    fun ack(ctx: Context, count: Int) {
        synchronized(lock) {
            val f = File(ctx.filesDir, QUEUE)
            if (!f.exists()) return
            val rest = f.readLines().filter { it.isNotBlank() }.drop(count)
            if (rest.isEmpty()) f.delete() else f.writeText(rest.joinToString("\n") + "\n")
        }
    }

    fun component(ctx: Context) = ComponentName(ctx, BankListener::class.java)
}

class BankListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            BankCapture.onPosted(applicationContext, sbn)
        } catch (e: Exception) {
            // Never crash the listener on an unusual notification.
        }
    }
}
