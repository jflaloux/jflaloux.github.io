# laloux.me

Personal site of Jean-François Laloux, served by GitHub Pages at [laloux.me](https://laloux.me).

Plain HTML, CSS and JavaScript, no build step:

- `index.html` — the page
- `assets/style.css` — styles and color tokens
- `assets/plot.js` — the scatter plot that sorts its points into a word (`data-word` on the canvas)
- `404.html` — not-found page, same plot with the word "404"

Preview locally with `python3 -m http.server` and open http://localhost:8000.

Cache: GitHub Pages lets browsers keep CSS/JS for hours, so the HTML loads them with
`?v=<hash>`. After changing `assets/style.css` or `assets/plot.js`, update the hash:

    CSS=$(md5 -q assets/style.css | cut -c1-8); JS=$(md5 -q assets/plot.js | cut -c1-8)
    sed -i '' -E "s#(style\.css)\?v=[0-9a-f]+#\1?v=$CSS#; s#(plot\.js)\?v=[0-9a-f]+#\1?v=$JS#" index.html 404.html
