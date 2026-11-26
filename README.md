# Scrapbook Scan

A free phone app for digitizing scrapbooks quickly. You turn the pages under your phone. Each page is captured hands-free, and every photo, ticket, card and clipping on it is cut out, straightened and saved as its own full-resolution picture. You don't have to frame and scan each item by hand.

Built with Expo (React Native) on top of the **catalog mode ("quick scan") kit** from Comic Vault: the tilt guide, the hands-free capture loop, duplicate skipping and the photo quality check all come from that kit.

## What it does

- **Hands-free page capture.** A guide frame turns red, amber or green as you line the phone up over the page (the tilt guide uses the motion sensor). When the page is square, steady and sharp, it takes the photo, buzzes and flashes. Then you turn the page. Tapping the frame captures straight away.
- **No duplicates.** It remembers the last 10 pages and won't capture the same one twice. Blank pages and empty tables are skipped.
- **Glare check.** Glossy photos and plastic page protectors reflect light, so the app waits and says "Glare on the page" until you tilt the book or move the light.
- **Finds each item on the page.** It works out the paper colour and finds everything that stands out from it, including white-bordered prints on white paper. It ignores handwriting, small stickers and the table around the page.
- **Straightens tilted items.** A photo stuck on at 12° is turned back and cut out square, at the camera's full resolution.
- **Asks when unsure.** If a page is clear, its items are saved automatically. Odd shapes, items running off the edge and busy patterned paper get a "to check" flag instead. On the check screen you can keep or skip each box, move or resize it, straighten it a degree at a time, add a box by hand, or keep the whole page.
- **Your photos.** Items are kept in page order. You can add a note to any item ("Aunt Rose, 1974"), turn it 90°, share it, or save a whole scrapbook to your phone's Photos in an album with the scrapbook's name.
- **Free and private.** There's no account, no server and no AI, so it costs nothing to run. Nothing leaves the phone until you save or share it.

## Run it

You need Node 22 or newer and the Expo Go app on your phone.

```
npm install
npx expo install --fix      # sets each package to the version that matches Expo SDK 57
npx expo start
```

Scan the QR code with Expo Go. Every package used works in Expo Go, so you don't need a development build to try it. Note that on Android, Expo Go limits access to the photo library; if "Save to Photos" fails there, make a development build (`npx eas-cli build --profile development`) or use Share.

### Tips for the best photos

- Use even daylight or two lamps at the sides. Avoid a single overhead light, which glares off glossy prints.
- Leave the phone light off unless the room is dim.
- Lay the book flat. Choose the frame shape that matches the page (square 12×12, tall 8½×11, or wide for a two-page spread), and fill the frame with the page.
- Leave "Best quality" on (album → Options). It uses the camera's largest picture size.

## How it fits together

```
src/app/
  index.tsx          your scrapbooks, start a new one
  scan.tsx           camera: guide frame, tilt guide, hands-free capture loop   (from the kit's catalog.tsx)
  album/[id].tsx     items grid, pages list, "to check" banner, save all to Photos, options
  page/[id].tsx      check a page: keep/skip, move, resize, straighten, add boxes, whole page
  item/[id].tsx      one item: note, turn 90°, save, share, fix the crop
src/lib/
  tilt.ts            phone angle and shake -> red/amber/green and which edge to tilt   (kit, unchanged)
  frame.ts           steady / new page / blank page decisions                          (kit, retuned)
  quality.ts         dark, washed out, blurry, glare                                   (kit + glare)
  detect.ts          finds the items on a page photo and their angle (pure, tested)
  geometry.ts        turn-then-crop maths for cutting items at full size (pure, tested)
  extract.ts         save page -> find items -> cut items; background queue; settings
  store.ts           scrapbooks, pages and items on the phone (AsyncStorage + files)
  export.ts          save to Photos, share
  pixels.ts          small RGBA copies of photos for measuring (jpeg-js)
tests/run.mjs        runs detect, geometry, frame, quality and tilt on made-up pages
```

## Tests

```
npm i -g typescript     # once
npm test
```

The tests paint sample scrapbook pages and check the results without a phone. The pages include tilted photos, white-bordered prints on white paper, a blank page, the table showing around the page, handwriting between photos, a sticker on a photo and striped paper. The tests also check that the turn-then-crop maths lands on the item to within a pixel, and that turning pages gives one capture each.

## Settings worth tuning

| Setting | File | Value | What it does |
|---|---|---|---|
| `STEADY_BELOW` | frame.ts | 0.12 | How still the page must be before a capture. |
| `NEW_PAGE_ABOVE` | frame.ts | 0.2 | How different from recent pages a new one must be. |
| `CAPTURE_GAP_MS` | frame.ts | 1500 | Pause after each capture while you turn the page. |
| `MIN_AREA` | detect.ts | 1.2% | Smallest item kept. Smaller things count as embellishments. |
| `SURE_FILL` | detect.ts | 0.82 | How rectangular an item must be to be saved without a look. |
| `EDGE` | detect.ts | 16 | Edge strength that marks an item's border (white on white). |
| `GLARE_SHARE` | quality.ts | 1.5% | How much glare is too much. |
| `CUT_PAD` | extract.ts | 1.2% | Border kept round each cut item so its edge is never trimmed. |
| `DETECT_LONG` | extract.ts | 520 px | Size of the copy used to find items. Bigger finds smaller items but is slower. |

## Known limits

- **Busy patterned paper** can hide where items end. Those pages are flagged "to check" so nothing wrong is saved silently.
- **White prints on white paper** are found from their faint edge shadow. If the light is perfectly flat, the white border may be trimmed, though the picture itself is kept.
- **Items that overlap a lot** may come out as one box. Split them on the check screen.
- **Notes are cleared** if you re-cut a page from the check screen.
- **Not yet tested on a phone.** The page-reading logic is tested on a computer, but the camera, item cutting and Photos parts still need a real-device check (see the first-run checklist below).

## First run on a real phone (checklist)

1. Capture one page with a photo stuck on at an angle. Check that the cut-out comes out straight. If it comes out tilted twice as much, flip the sign of `rotate` in `geometry.ts` `planCut`, because that would mean `expo-image-manipulator` turns the other way on your platform.
2. Turn pages at your normal speed. If you get blurry captures, lower `STEADY_BELOW`. If it's slow to fire, raise it slightly.
3. Try a glossy photo under a lamp and check that the glare hint appears.
4. Save a scrapbook to Photos and check that the album appears.

## Publishing

1. Change `ios.bundleIdentifier` and `android.package` in `app.json` from `com.example.scrapbookscan` to your own.
2. Add an app icon and splash (`assets/`, referenced from `app.json`).
3. `npx eas-cli build --profile production`, then submit.
4. Android: `ACTIVITY_RECOGNITION` is already blocked in `app.json`. expo-sensors adds it, and without the block Google Play asks for a health declaration (a lesson from the kit). The privacy answers are simple: no data collected, no data shared.

## Credits

- The capture loop, tilt guide and photo checks are adapted from Comic Vault's catalog mode kit (v1.4.0).
- JPEG decoding on the phone uses [jpeg-js](https://github.com/jpeg-js/jpeg-js).
