package kr.feeledu.attendance;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** A visible recovery screen when no enabled Custom Tabs browser is available. */
public final class BrowserRequiredActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER);
        int padding = (int) (32 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        TextView title = new TextView(this);
        title.setText("브라우저 확인 필요");
        title.setTextSize(24);
        layout.addView(title);
        TextView message = new TextView(this);
        message.setText("Chrome 등 지원 브라우저를 켜거나 업데이트해 주세요.");
        message.setTextSize(16);
        message.setPadding(0, padding / 2, 0, padding / 2);
        layout.addView(message);
        Button retry = new Button(this);
        retry.setText("다시 시도");
        retry.setOnClickListener(view -> {
            startActivity(new Intent(this, MainActivity.class));
            finish();
        });
        layout.addView(retry);
        setContentView(layout);
    }
}
