# Map Wager

Bet chips on how well you know the world. Live at **https://mapwager.com**.

7 places a day, the same for everyone. Start with 1,000 chips; each place has a line (tap within *r* miles) and a payout. Stack chips, tap the globe: hit and win bet × payout, miss and lose the bet. Cash out any time; hit 0 and you're busted.

Static site, no build step:

```
python3 -m http.server
```

- `places.js` - the place pool (`r` = line in miles, `pays` = profit multiple). Day N uses the next 7 places from one fixed shuffle.
- `app.js` - game logic (Mapbox GL globe, terrain style, labels/roads hidden, country borders shown)
- `config.js` - Mapbox public token (URL-restricted in the Mapbox dashboard)
- `base.css`, `pins.css`, `style.css` - layout, map pins, casino theme
- `CNAME` - custom domain for GitHub Pages
