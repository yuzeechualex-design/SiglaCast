package com.siglacast.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

public class SiglaOverlayBridge {
    private final Context context;

    SiglaOverlayBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context);
    }

    @JavascriptInterface
    public void requestPermission() {
        if (canDrawOverlays()) return;
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + context.getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    @JavascriptInterface
    public void update(String payloadJson) {
        Intent intent = new Intent(context, ChatHeadService.class);
        intent.setAction(ChatHeadService.ACTION_UPDATE);
        intent.putExtra(ChatHeadService.EXTRA_PAYLOAD, payloadJson == null ? "{}" : payloadJson);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    @JavascriptInterface
    public void stop() {
        Intent intent = new Intent(context, ChatHeadService.class);
        intent.setAction(ChatHeadService.ACTION_STOP);
        context.startService(intent);
    }
}
