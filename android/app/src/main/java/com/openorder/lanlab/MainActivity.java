package com.openorder.lanlab;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(OpenOrderHostPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
