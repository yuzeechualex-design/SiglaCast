package com.siglacast.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

public class ChatHeadService extends Service {
    public static final String ACTION_UPDATE = "com.siglacast.app.CHAT_HEAD_UPDATE";
    public static final String ACTION_STOP = "com.siglacast.app.CHAT_HEAD_STOP";
    public static final String EXTRA_PAYLOAD = "payload";

    private static final String CHANNEL_ID = "siglacast_chathead";
    private static final int NOTIFICATION_ID = 7421;

    private WindowManager windowManager;
    private FrameLayout bubbleView;
    private LinearLayout panelView;
    private WindowManager.LayoutParams bubbleParams;
    private WindowManager.LayoutParams panelParams;
    private JSONObject payload = new JSONObject();
    private boolean panelOpen = false;
    private float downX;
    private float downY;
    private int startX;
    private int startY;

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildForegroundNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!canOverlay()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && intent.hasExtra(EXTRA_PAYLOAD)) {
            try {
                payload = new JSONObject(intent.getStringExtra(EXTRA_PAYLOAD));
            } catch (Exception ignored) {
                payload = new JSONObject();
            }
        }
        int total = Math.max(0, payload.optInt("messages", 0)) + Math.max(0, payload.optInt("announcements", 0));
        if (total <= 0) {
            stopSelf();
            return START_NOT_STICKY;
        }
        ensureBubble();
        updateBubble();
        if (panelOpen) updatePanel();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        removePanel();
        removeBubble();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private boolean canOverlay() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this);
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void ensureBubble() {
        if (bubbleView != null) return;
        bubbleView = new FrameLayout(this);
        bubbleView.setClipChildren(false);

        ImageView icon = new ImageView(this);
        icon.setImageResource(getApplicationInfo().icon);
        icon.setBackgroundColor(Color.TRANSPARENT);
        FrameLayout.LayoutParams iconLp = new FrameLayout.LayoutParams(dp(58), dp(58), Gravity.CENTER);
        bubbleView.addView(icon, iconLp);

        TextView badge = new TextView(this);
        badge.setId(View.generateViewId());
        badge.setTag("badge");
        badge.setTextColor(Color.WHITE);
        badge.setTextSize(12);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setGravity(Gravity.CENTER);
        badge.setBackground(makeRoundDrawable(0xffef233c, dp(18)));
        FrameLayout.LayoutParams badgeLp = new FrameLayout.LayoutParams(dp(26), dp(22), Gravity.TOP | Gravity.RIGHT);
        bubbleView.addView(badge, badgeLp);

        bubbleParams = new WindowManager.LayoutParams(
            dp(74),
            dp(74),
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );
        bubbleParams.gravity = Gravity.TOP | Gravity.LEFT;
        bubbleParams.x = getResources().getDisplayMetrics().widthPixels - dp(88);
        bubbleParams.y = dp(130);

        bubbleView.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    startX = bubbleParams.x;
                    startY = bubbleParams.y;
                    downX = event.getRawX();
                    downY = event.getRawY();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    bubbleParams.x = startX + (int) (event.getRawX() - downX);
                    bubbleParams.y = startY + (int) (event.getRawY() - downY);
                    windowManager.updateViewLayout(bubbleView, bubbleParams);
                    return true;
                case MotionEvent.ACTION_UP:
                    float moved = Math.abs(event.getRawX() - downX) + Math.abs(event.getRawY() - downY);
                    if (moved < dp(10)) togglePanel();
                    return true;
                default:
                    return false;
            }
        });

        windowManager.addView(bubbleView, bubbleParams);
    }

    private void updateBubble() {
        int total = payload.optInt("messages", 0) + payload.optInt("announcements", 0);
        TextView badge = findTaggedText(bubbleView, "badge");
        if (badge != null) badge.setText(total > 99 ? "99+" : String.valueOf(total));
    }

    private void togglePanel() {
        if (panelOpen) {
            removePanel();
            return;
        }
        panelOpen = true;
        updatePanel();
    }

    private void updatePanel() {
        removePanel();
        panelOpen = true;

        panelView = new LinearLayout(this);
        panelView.setOrientation(LinearLayout.VERTICAL);
        panelView.setPadding(dp(14), dp(12), dp(14), dp(12));
        panelView.setBackground(makeRoundDrawable(0xee101827, dp(20)));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setOrientation(LinearLayout.HORIZONTAL);
        TextView title = text("SiglaCast", 18, true, Color.WHITE);
        header.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        TextView close = text("×", 24, true, Color.WHITE);
        close.setGravity(Gravity.CENTER);
        close.setOnClickListener(v -> removePanel());
        header.addView(close, new LinearLayout.LayoutParams(dp(42), dp(38)));
        panelView.addView(header);

        LinearLayout tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabs.setPadding(0, dp(8), 0, dp(8));
        tabs.addView(tab("Messages", payload.optInt("messages", 0), "/messages"), new LinearLayout.LayoutParams(0, dp(42), 1));
        tabs.addView(tab("Announcements", payload.optInt("announcements", 0), "/announcements"), new LinearLayout.LayoutParams(0, dp(42), 1));
        panelView.addView(tabs);

        ScrollView scroller = new ScrollView(this);
        LinearLayout rows = new LinearLayout(this);
        rows.setOrientation(LinearLayout.VERTICAL);
        addSection(rows, "Messages", payload.optJSONArray("latestMessages"), "No unread messages.", "/messages");
        addSection(rows, "Announcements", payload.optJSONArray("latestAnnouncements"), "No new announcements.", "/announcements");
        scroller.addView(rows);
        panelView.addView(scroller, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        panelParams = new WindowManager.LayoutParams(
            Math.min(getResources().getDisplayMetrics().widthPixels - dp(28), dp(380)),
            dp(430),
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        );
        panelParams.gravity = Gravity.TOP | Gravity.LEFT;
        panelParams.x = Math.max(dp(10), Math.min(bubbleParams.x - dp(300), getResources().getDisplayMetrics().widthPixels - dp(392)));
        panelParams.y = Math.max(dp(48), bubbleParams.y + dp(78));
        windowManager.addView(panelView, panelParams);
    }

    private View tab(String label, int count, String route) {
        TextView view = text(label + "  " + count, 13, true, Color.WHITE);
        view.setGravity(Gravity.CENTER);
        view.setBackground(makeRoundDrawable(0x332d6cdf, dp(14)));
        view.setOnClickListener(v -> openRoute(route));
        return view;
    }

    private void addSection(LinearLayout parent, String label, JSONArray items, String empty, String route) {
        TextView heading = text(label, 12, true, 0xffa8b3cf);
        heading.setPadding(0, dp(10), 0, dp(4));
        parent.addView(heading);

        if (items == null || items.length() == 0) {
            TextView none = text(empty, 13, false, 0xffd7def5);
            none.setPadding(0, dp(4), 0, dp(8));
            parent.addView(none);
            return;
        }
        for (int i = 0; i < Math.min(items.length(), 3); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            TextView row = text(item.optString("title", "SiglaCast"), 14, true, Color.WHITE);
            String subtitle = item.optString("subtitle", "");
            if (!subtitle.isEmpty()) row.setText(row.getText() + "\n" + subtitle);
            row.setTextColor(Color.WHITE);
            row.setPadding(dp(10), dp(8), dp(10), dp(8));
            row.setBackground(makeRoundDrawable(0x1fffffff, dp(12)));
            row.setOnClickListener(v -> openRoute(route));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            lp.setMargins(0, dp(4), 0, dp(4));
            parent.addView(row, lp);
        }
    }

    private void openRoute(String route) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("route", route);
        startActivity(intent);
        removePanel();
    }

    private void removeBubble() {
        if (bubbleView == null) return;
        try {
            windowManager.removeView(bubbleView);
        } catch (Exception ignored) {
        }
        bubbleView = null;
    }

    private void removePanel() {
        panelOpen = false;
        if (panelView == null) return;
        try {
            windowManager.removeView(panelView);
        } catch (Exception ignored) {
        }
        panelView = null;
    }

    private TextView findTaggedText(View view, String tag) {
        if (view instanceof TextView && tag.equals(view.getTag())) return (TextView) view;
        if (view instanceof FrameLayout) {
            FrameLayout group = (FrameLayout) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                TextView found = findTaggedText(group.getChildAt(i), tag);
                if (found != null) return found;
            }
        }
        return null;
    }

    private TextView text(String value, int sp, boolean bold, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setIncludeFontPadding(true);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private android.graphics.drawable.GradientDrawable makeRoundDrawable(int color, int radius) {
        android.graphics.drawable.GradientDrawable d = new android.graphics.drawable.GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(radius);
        return d;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "SiglaCast floating bubble",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps the SiglaCast floating notification bubble available.");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildForegroundNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("SiglaCast bubble is active")
            .setContentText("Unread messages and announcements can pop up as a floating bubble.")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }
}
