# The proxy is reached only through the app's own code; nothing reflective is
# used, so the default rules are enough. These two keep a release build from
# stripping the entry points the manifest names.
-keep class dev.opencodemanager.app.OpenCodeApp { *; }
-keep class dev.opencodemanager.app.MainActivity { *; }

# `ProxyServer` catches Throwable on the streaming path, and R8 cannot see that
# those types are load-bearing.
-keep class dev.opencodemanager.proxy.ProxyConnectionLost { *; }