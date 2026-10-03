# Home kiosk

The iPad shows one page at a time from this repo, served by an old laptop on
the local network. Anything on the LAN can switch the page by hitting a URL,
and Google Home does it through a virtual Matter switch. Nothing leaves the
house and nothing is hosted publicly.

```
"Hey Google, show me the planes"
   └─ Google Home routine turns on the "Planes" switch
        └─ Matterbridge (on the laptop) calls http://localhost:3000/show/planes
             └─ kiosk server tells the iPad over Server-Sent Events
                  └─ kiosk.js on the current page navigates to /planes/
```

## 1. Laptop: run the server

Needs Node 18 or newer. No npm install.

```sh
cd /path/to/calebandmelissa
node kiosk/server.js            # http://<laptop>:3000
```

Endpoints:

| URL | What it does |
| --- | --- |
| `/photoframe.html`, `/sky-map/`, … | the pages themselves, served from this repo |
| `/show/<name>` | switch the iPad to that app |
| `/current` | JSON of the current app |
| `/events` | Server-Sent Events stream the iPad listens to |
| `/kiosk/` | tap-to-switch control page, handy from a phone |

The server also proxies the sky map's data routes (`/api`, `/db`, `/lookup`,
`/jetapi`), see `skyproxy.js`, so the planes page gets its data straight from
the laptop instead of the Cloudflare worker. Put the OpenSky OAuth client in
`sky-map/credentials.json` (gitignored) as `{"clientId": …, "clientSecret": …}`
for the higher authenticated rate limit. Without it OpenSky is queried
anonymously, which still works but polls less often.

Apps are the `APPS` map at the top of `server.js`. To add one, drop a page in
the repo, add a line there, include the kiosk script in the page, restart.

Keep it running across reboots on macOS with a LaunchAgent, e.g.
`~/Library/LaunchAgents/com.home.kiosk.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.home.kiosk</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/node</string><string>/path/to/calebandmelissa/kiosk/server.js</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/kiosk.log</string>
  <key>StandardErrorPath</key><string>/tmp/kiosk.log</string>
</dict></plist>
```

```sh
launchctl load ~/Library/LaunchAgents/com.home.kiosk.plist
```

Give the laptop a fixed IP or rely on its `.local` name (System Settings →
General → Sharing → Local hostname), and turn off sleep while plugged in.

## 2. Pages: include the kiosk script

Every page that can appear on the iPad includes one line before `</body>`,
with `data-app` set to its name in `APPS`:

```html
<script src="/kiosk/kiosk.js" data-app="photoframe"></script>
```

That script listens to `/events` and navigates to whichever app is current.
Navigation is same-origin, so a Home Screen web app stays full screen.

## 3. iPad: open the frame from the laptop

1. In Safari open `http://<laptop>.local:3000/photoframe.html`.
2. Share → Add to Home Screen. Open it from there so it runs full screen.
3. Re-add the photos once. The old library was tied to the
   `calebandmelissa.com` origin and does not carry over.
4. Settings → Display & Brightness → Auto-Lock → Never.
5. Optional: Settings → Accessibility → Guided Access, then triple-click to
   lock the iPad into the app.

Test from a phone: open `http://<laptop>.local:3000/kiosk/` and tap an app.
The iPad should switch within a second.

## 4. Google Home: Matterbridge with the webhooks plugin

Google Home cannot call a local URL, so the laptop pretends to be a Matter
device with one switch per app. Flipping a switch calls `/show/<name>`.

You need a Google device that acts as a Matter controller on the same Wi-Fi:
Nest Hub (2nd gen), Nest Hub Max, Nest Mini, Nest Audio, Nest Wifi Pro, or
Chromecast with Google TV. The original Google Home and Home Mini do not
qualify.

```sh
npm install -g matterbridge matterbridge-webhooks
matterbridge -add matterbridge-webhooks
matterbridge -bridge                 # or -service to install it as a daemon
```

Open the Matterbridge frontend (`http://<laptop>:8283`), go to the webhooks
plugin config and add one webhook per app:

| Name | Method | URL |
| --- | --- | --- |
| Planes | GET | `http://localhost:3000/show/planes` |
| Photo Frame | GET | `http://localhost:3000/show/photoframe` |

Each shows up as a switch that turns itself back off a few seconds after
firing, so it can be triggered again and again.

Pair it: Google Home app → + → Add device → Matter-enabled device, and scan
the QR code shown in the Matterbridge frontend. The switches appear as
devices. Then make routines in the Google Home app:

| You say | Action |
| --- | --- |
| "show me the planes" | Turn on Planes |
| "show the photos" | Turn on Photo Frame |

"Hey Google, turn on Planes" works immediately without any routine.

Matter commissioning wants multicast and IPv6 link-local between the laptop
and the Google device. If pairing fails, plug the laptop into Ethernet, make
sure it is not on a guest network, and try again.
