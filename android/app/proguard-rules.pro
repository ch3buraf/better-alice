# Keep @JavascriptInterface methods reachable for the WebView bridge.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.betteralice.app.WebViewBridge { *; }
