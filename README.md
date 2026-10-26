# Dron v ravnotežju

Celozaslonski 3D-prikaz za promocijo študija Avtomatike in robotike na UM FERI.
Dron vzleti s travnika, nato lebdi. Obiskovalec ga lahko povleče ali nanj
pošlje sunek vetra, regulator pa ga vrne v lebdenje.

Stran je statična (HTML, CSS, JavaScript). Three.js se naloži s CDN-ja,
namestitev in gradnja nista potrebni.

## Ogled

Datoteke potrebujejo strežnik (ne `file://`):

```sh
python3 -m http.server 8000
```

Nato odpri <http://localhost:8000>.

## Upravljanje

- **Povleci dron**: sila prijema ga nagne in odnese, regulator se upira.
- **Klik ob dronu** ali **preslednica**: sunek vetra.
- **WASD** ali puščice: premik želenega položaja, **Q** / **E**: višina.
- **R** ali gumb »Ponovi vzlet«: ponovi uvod.

## Struktura

- `index.html`: celozaslonski prizor, besedilo, telemetrija in gumbi.
- `css/style.css`: postavitev in odzivni slogi.
- `js/physics.js`: model kvadrokopterja in regulator, brez odvisnosti od Three.js.
- `js/drone-model.js`: mreža Skydio X2, propelerji z zameglitvijo gibanja in navigacijske luči.
- `js/main.js`: prizor, osvetlitev iz HDRI, potek vzleta, kamera in interakcija.
- `tests/physics.test.mjs`: testi fizike in regulatorja.
- `assets/`: model drona in okolje.

## Fizika in vodenje

- **Model:** togo telo s 6 prostostnimi stopnjami. Masa (1,325 kg) in razporeditev
  rotorjev sta povzeti po modelu Skydio X2 v MuJoCo Menagerie.
- **Motorji:** vsak ima zakasnitev prvega reda (40 ms) in omejen potisk (13 N).
- **Regulator** je kaskaden:
  - Položajni PD (z integralom po višini) določi želeni pospešek.
  - Iz pospeška izhajata skupni potisk in želena orientacija.
  - Geometrijski regulator orientacije na SO(3) izračuna navore.
  - Mešalnik jih razdeli med motorje. Odklon ima najnižjo prednost, kot pri pravih krmilnikih leta.
- **Simulacija** teče s korakom 2 ms (500 Hz), neodvisno od hitrosti izrisa.

```sh
npm test
```

## Viri in licence

- Model drona: **Skydio X2**, Skydio, [Apache 2.0](assets/models/LICENSE-skydio-x2.txt),
  iz [google-deepmind/mujoco_menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/main/skydio_x2).
  Spremenjeno: odstranjeni so ploski diski propelerjev; propelerji so izrisani v kodi.
- Okolje: **Alps Field**, Andreas Mischok, [Poly Haven](https://polyhaven.com/a/alps_field), CC0.
  Ozadje je 8K tonsko preslikan JPG, osvetlitev pa 1K HDR.
- [Three.js](https://threejs.org/) 0.170, MIT, naložen s CDN-ja jsDelivr.
