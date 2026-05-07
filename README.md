# Background App Icons

**Show Background Apps in the top bar with an icon and menu for quick access to actions**

![Screenshot](screenshot.png)

GNOME Shell supports background apps through the xdg-desktop-portal. People complain about not having status icons for their apps. This extension just shows those same background apps directly top bar, in case that's your thing.

Hovering an app icon shows a tooltip with its name. Selecting the icon shows its status and menu items to open a window or quit the app. Everything you can already do from the Background Apps menu, but right on the top bar.

## Requirements

GNOME Shell 50

## Installation

Copy or symlink the extension directory to `~/.local/share/gnome-shell/extensions/background-app-icons@cassidyjames.com`, then enable it:

```sh
gnome-extensions enable background-app-icons@cassidyjames.com
```
