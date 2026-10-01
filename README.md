# Map Wager

Bet chips on how well you know the world. Live at **https://mapwager.com**.

7 places a day, the same for everyone. Start with 100 chips; the bankroll carries over day to day (+10 free chips each new day). Each place has a line (tap within *r* miles) and a payout. Stack chips (sizes scale with your bankroll), then tap the globe: hit and win bet × payout, miss and lose the bet, or Pass. At 0 chips you can still play for fun until tomorrow's chips arrive. Hit 3 in a row for a 🔥 hot streak (+0.5× until you miss); the last round is a ⭐ bonus round (pays double). Progress is stored in the browser.

Static site, no build step:

```
python3 -m http.server
```

- `places.js` - the place pool (`r` = line in miles, `pays` = profit multiple). Day N uses the next 7 places from one fixed shuffle (Sep 30 and Oct 1 used the original 142-place pool).
- `app.js` - game logic (Mapbox GL globe, terrain style, labels/roads hidden, country borders shown)
- `config.js` - Mapbox public token (URL-restricted in the Mapbox dashboard)
- `base.css`, `pins.css`, `style.css` - layout, map pins, casino theme
- `CNAME` - custom domain for GitHub Pages
