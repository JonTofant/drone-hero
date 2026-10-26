# Dron v ravnotežju

Celozaslonski prikaz za promocijo študija Avtomatike in robotike na UM FERI.
Ozadje je pravi video posnetek travnika pod gorovjem Drakensberg, dron pa je 3D
in vstavljen v posnetek. Vzleti z vzletne podloge in obleti do kamere, nato lebdi.
Obiskovalec ga lahko povleče ali nanj pošlje sunek vetra, regulator pa ga vrne v lebdenje.

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
- `js/plate.js`: video ozadje, kamera, usklajena s posnetkom, in enako obrezovanje obeh plasti.
- `js/pad.js`: vzletna podloga.
- `js/main.js`: osvetlitev, senca, potek vzleta in interakcija.
- `tests/physics.test.mjs`: testi fizike in regulatorja.
- `assets/`: model drona in okolje.

## Posnetek in vstavljanje drona

- **Posnetek:** Pexels 3115566 (Magda Ehlers). Kamera med 4. in 20. sekundo miruje;
  to je preverjeno s sledenjem točkam na grebenih in grmovju. Zanka traja 14 s
  in ima 2-sekundni prelivni prehod. Ločljivosti sta 1080p in 720p (za majhne zaslone).
- **Kamera:** usklajena s posnetkom (`PLATE` v `js/plate.js`):
  - višina okoli 1 m in navpični zorni kot 45°;
  - višina oči pri 57 % višine slike in rahel nagib.
  Video in 3D-plast se pri vsakem razmerju zaslona obrežeta enako (`setViewOffset`).
- **Svetloba:** oblačno nebo (HDRI Fouriesburg Mountain Cloudy) in mehka luč s
  sprednje desne strani, kjer je oblak najsvetlejši.
  - Senca je mehka (VSM), pod dronom je še okluzija.
  - Osvetljenost drona sledi svetlosti trate v posnetku (`plate-light.json`).
- **Postavitev:** dron po vzletu obleti na točko, ki je na vseh zaslonih v isti
  navpičnici kot podloga, zato je viden tudi na ozkih telefonih.

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
- Posnetek: Magda Ehlers, [Pexels 3115566](https://www.pexels.com/video/scenic-view-of-the-mountain-and-clouds-from-a-valley-3115566/),
  licenca Pexels. Skrajšan, zapet v zanko in ponovno kodiran.
- Osvetlitev: **Fouriesburg Mountain Cloudy**, Dimitrios Savva in Jarod Guest,
  [Poly Haven](https://polyhaven.com/a/fouriesburg_mountain_cloudy), CC0.
- [Three.js](https://threejs.org/) 0.170, MIT, naložen s CDN-ja jsDelivr.
