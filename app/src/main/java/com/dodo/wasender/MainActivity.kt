package com.dodo.wasender

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File

class MainActivity : Activity() {

    private val waUrl = "https://web.whatsapp.com/"
    private val desktopUa =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

    private lateinit var wa: WebView
    private lateinit var panel: WebView
    private var injectJs = ""
    private var chooserCb: ValueCallback<Array<Uri>>? = null
    private var waOnTop = false

    // ---------- tiny persistent store (replaces chrome.storage.local) ----------
    private val lock = Any()
    private var store = JSONObject()
    private val storeFile by lazy { File(filesDir, "store.json") }
    private val attFile by lazy { File(filesDir, "attachment.json") }

    private fun loadStore() {
        synchronized(lock) {
            store = try { JSONObject(storeFile.readText()) } catch (e: Exception) { JSONObject() }
            // never auto-resume a send after the app was closed
            val st = store.optJSONObject("state")
            if (st != null && st.optBoolean("running", false)) {
                st.put("running", false)
                st.put("status", "تم الإيقاف")
                st.put("pendingNav", JSONObject.NULL)
                persist()
            }
        }
    }

    private fun persist() {
        try { storeFile.writeText(store.toString()) } catch (e: Exception) { }
    }

    private fun keysOf(json: String): List<String> {
        return when (val v = JSONTokener(json).nextValue()) {
            is String -> listOf(v)
            is JSONArray -> (0 until v.length()).map { v.getString(it) }
            else -> store.keys().asSequence().toList()
        }
    }

    inner class Bridge {
        @JavascriptInterface
        fun get(keysJson: String): String {
            synchronized(lock) {
                val out = JSONObject()
                for (k in keysOf(keysJson)) {
                    if (k == "attachment") {
                        if (attFile.exists()) {
                            try { out.put(k, JSONObject(attFile.readText())) } catch (e: Exception) { }
                        }
                    } else if (store.has(k)) {
                        out.put(k, store.get(k))
                    }
                }
                return out.toString()
            }
        }

        @JavascriptInterface
        fun set(objJson: String) {
            synchronized(lock) {
                val o = JSONObject(objJson)
                val it = o.keys()
                while (it.hasNext()) {
                    val k = it.next()
                    if (k == "attachment") {
                        try { attFile.writeText(o.get(k).toString()) } catch (e: Exception) { }
                    } else {
                        store.put(k, o.get(k))
                    }
                }
                persist()
            }
        }

        @JavascriptInterface
        fun remove(keysJson: String) {
            synchronized(lock) {
                for (k in keysOf(keysJson)) {
                    if (k == "attachment") attFile.delete() else store.remove(k)
                }
                persist()
            }
        }

        @JavascriptInterface
        fun openWA() {
            runOnUiThread { startWA() }
        }

        @JavascriptInterface
        fun saveCsv(text: String) {
            try {
                val v = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, "wa-results.csv")
                    put(MediaStore.Downloads.MIME_TYPE, "text/csv")
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
                if (uri != null) {
                    contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                }
                runOnUiThread { Toast.makeText(this@MainActivity, "تم الحفظ في Downloads", Toast.LENGTH_LONG).show() }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, "تعذر الحفظ", Toast.LENGTH_LONG).show() }
            }
        }
    }

    // ---------- UI ----------
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        loadStore()
        injectJs = assets.open("wa_inject.js").bufferedReader().use { it.readText() }

        val match = ViewGroup.LayoutParams.MATCH_PARENT
        val wrap = ViewGroup.LayoutParams.WRAP_CONTENT

        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL

        val bar = LinearLayout(this)
        bar.orientation = LinearLayout.HORIZONTAL
        bar.setBackgroundColor(Color.parseColor("#12332D"))
        val b1 = Button(this)
        b1.text = "لوحة التحكم"
        val b2 = Button(this)
        b2.text = "واتساب"
        bar.addView(b1, LinearLayout.LayoutParams(0, wrap, 1f))
        bar.addView(b2, LinearLayout.LayoutParams(0, wrap, 1f))

        val frame = FrameLayout(this)
        wa = WebView(this)
        panel = WebView(this)
        frame.addView(wa, FrameLayout.LayoutParams(match, match))
        frame.addView(panel, FrameLayout.LayoutParams(match, match))

        root.addView(bar, LinearLayout.LayoutParams(match, wrap))
        root.addView(frame, LinearLayout.LayoutParams(match, 0, 1f))
        setContentView(root)

        setupWa()
        setupPanel()
        b1.setOnClickListener { showPanel() }
        b2.setOnClickListener { showWa() }
        showPanel()
    }

    private fun showPanel() { waOnTop = false; panel.bringToFront() }
    private fun showWa() { waOnTop = true; wa.bringToFront() }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWa() {
        val s = wa.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.userAgentString = desktopUa
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.setSupportZoom(true)
        s.builtInZoomControls = true
        s.displayZoomControls = false
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(wa, true)
        wa.addJavascriptInterface(Bridge(), "AndroidStore")
        wa.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                if (view != null && url != null && url.startsWith(waUrl)) {
                    view.evaluateJavascript(injectJs, null)
                }
            }
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val u = request?.url ?: return false
                if (u.toString().startsWith("https://web.whatsapp.com")) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }
                return true
            }
        }
        wa.loadUrl(waUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupPanel() {
        val s = panel.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = true
        panel.addJavascriptInterface(Bridge(), "AndroidStore")
        panel.webViewClient = WebViewClient()
        panel.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: WebChromeClient.FileChooserParams?
            ): Boolean {
                chooserCb?.onReceiveValue(null)
                chooserCb = filePathCallback
                return try {
                    startActivityForResult(fileChooserParams!!.createIntent(), 77)
                    true
                } catch (e: Exception) {
                    chooserCb = null
                    false
                }
            }
        }
        panel.loadUrl("file:///android_asset/panel/index.html")
    }

    private fun startWA() {
        showWa()
        val u = wa.url
        if (u != null && u.startsWith(waUrl) && wa.progress == 100) {
            wa.evaluateJavascript(injectJs, null)
        } else {
            wa.loadUrl(waUrl)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == 77) {
            chooserCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            chooserCb = null
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (waOnTop) showPanel() else super.onBackPressed()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }
}
