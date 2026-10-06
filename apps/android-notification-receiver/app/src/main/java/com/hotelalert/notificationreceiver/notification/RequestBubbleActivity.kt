package com.hotelalert.notificationreceiver.notification

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.hotelalert.notificationreceiver.R

/**
 * Small native surface used only when the launcher opens the optional request
 * bubble. The normal notification still opens the full WebView console.
 */
class RequestBubbleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val padding = (resources.displayMetrics.density * 20).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
            setBackgroundColor(Color.WHITE)
        }

        val title = textView(intent.getStringExtra(EXTRA_TITLE).orEmpty(), 20f, true)
        val room = textView(intent.getStringExtra(EXTRA_ROOM).orEmpty(), 16f, true)
        val service = textView(intent.getStringExtra(EXTRA_SERVICE).orEmpty(), 15f, false)
        val area = textView(intent.getStringExtra(EXTRA_AREA).orEmpty(), 14f, false)
        root.addView(title)
        root.addView(room, marginParams(top = 12))
        root.addView(service, marginParams(top = 8))
        root.addView(area, marginParams(top = 4))

        val accept = Button(this).apply {
            text = getString(R.string.receiver_accept_start_request)
            setOnClickListener {
                readActionIntent(intent)?.let { startActivity(it) }
                finish()
            }
        }
        root.addView(accept, marginParams(top = 18))
        setContentView(root)
    }

    private fun textView(value: String, size: Float, bold: Boolean): TextView = TextView(this).apply {
        text = value
        textSize = size
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setTextColor(Color.rgb(24, 32, 43))
    }

    private fun marginParams(top: Int): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply {
        topMargin = (resources.displayMetrics.density * top).toInt()
    }

    private fun readActionIntent(source: Intent): Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        source.getParcelableExtra(EXTRA_ACCEPT_ACTION_INTENT, Intent::class.java)
    } else {
        @Suppress("DEPRECATION")
        source.getParcelableExtra(EXTRA_ACCEPT_ACTION_INTENT)
    }

    companion object {
        const val EXTRA_TITLE = "bubbleTitle"
        const val EXTRA_ROOM = "bubbleRoom"
        const val EXTRA_SERVICE = "bubbleService"
        const val EXTRA_AREA = "bubbleArea"
        const val EXTRA_ACCEPT_ACTION_INTENT = "bubbleAcceptActionIntent"
    }
}
