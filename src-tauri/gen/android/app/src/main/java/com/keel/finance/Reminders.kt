package com.keel.finance

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/** Local reminders: stored in SharedPreferences so they survive reboots; no server involved. */
object Reminders {
    private const val PREFS = "keel_reminders"
    private const val KEY = "items"
    const val CHANNEL = "keel_reminders"

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_DEFAULT).apply {
                        description = "Upcoming bills and budget warnings"
                    }
                )
            }
        }
    }

    private fun pending(ctx: Context, id: Int, title: String, body: String): PendingIntent {
        val i = Intent(ctx, NotifyReceiver::class.java).apply {
            putExtra("id", id)
            putExtra("title", title)
            putExtra("body", body)
        }
        return PendingIntent.getBroadcast(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Replace all scheduled reminders with `items` ([{id, at (epoch ms), title, body}]). */
    fun schedule(ctx: Context, items: JSONArray) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val old = JSONArray(prefs.getString(KEY, "[]"))
        for (k in 0 until old.length()) {
            val o = old.getJSONObject(k)
            am.cancel(pending(ctx, o.getInt("id"), o.optString("title"), o.optString("body")))
        }
        val now = System.currentTimeMillis()
        val kept = JSONArray()
        for (k in 0 until items.length()) {
            val o = items.getJSONObject(k)
            val at = o.getLong("at")
            if (at <= now) continue
            // Inexact alarm: no special permission needed, delivered within a few minutes.
            am.set(AlarmManager.RTC_WAKEUP, at, pending(ctx, o.getInt("id"), o.getString("title"), o.getString("body")))
            kept.put(o)
        }
        prefs.edit().putString(KEY, kept.toString()).apply()
    }

    fun reschedule(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        schedule(ctx, JSONArray(prefs.getString(KEY, "[]")))
    }

    fun show(ctx: Context, id: Int, title: String, body: String) {
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        // On the lock screen only a neutral text is shown; details appear once unlocked.
        val public = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher_foreground)
            .setContentTitle("Keel")
            .setContentText("You have a reminder")
            .build()
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(public)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(id, n)
        } catch (e: SecurityException) {
            // Permission revoked: nothing to show.
        }
    }
}

class NotifyReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Reminders.show(ctx, intent.getIntExtra("id", 0), intent.getStringExtra("title") ?: "Keel", intent.getStringExtra("body") ?: "")
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) Reminders.reschedule(ctx)
    }
}

internal fun jsonOf(vararg pairs: Pair<String, Any?>): JSONObject = JSONObject().apply { pairs.forEach { put(it.first, it.second) } }
