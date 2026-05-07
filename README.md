# Background App Icons for GNOME Shell

**Show background apps directly in the top bar!**

![Screenshot](screenshot.png)

GNOME Shell supports background apps through the xdg-desktop-portal. People complain about not having status icons for their apps. This extension just shows those same background apps directly top bar, in case that's your thing.

Hovering an app icon shows a tooltip with its name. Selecting the icon shows its status and menu items to open a window or quit the app. Everything you can already do from the Background Apps menu, but right on the top bar.

## Requirements

The extension depends on the `org.freedesktop.background.Monitor` D-Bus interface, provided by `xdg-desktop-portal-gnome`. It targets GNOME Shell 47–50.

## Installation

Copy or symlink the extension directory to `~/.local/share/gnome-shell/extensions/background-app-icons@cassidyjames.com`, then enable it:

```sh
gnome-extensions enable background-app-icons@cassidyjames.com
```
