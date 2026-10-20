# Vision Trainer

Screen-based vision therapy exercises I use during concussion recovery. Plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages.

## Exercises

- **Vergence cards**: the original crossing/relaxing eccentric-circles test. Free mode records your best separation; break/recovery mode ramps the separation to measure your fusional range; jump mode snaps between two separations.
- **Smooth pursuits**: follow a target along lines, circles, figure 8s or an unpredictable path.
- **Saccades**: metronome or self-paced eye jumps between letter targets.
- **Hart chart**: letter grid with guided reading patterns.
- **Gaze stabilization (VOR x1)**: hold a letter clear while turning your head to a beat.
- **Motion tolerance (OKN)**: moving stripes with adjustable speed and contrast.
- **Peripheral awareness**: catch flashes at the edge of vision while fixating the center.
- **Rest and reset**: palming with paced breathing, or 20-20-20 distance breaks.

## Tracking

Sessions, vergence records and symptom check-ins are saved in the browser (localStorage). The Progress page charts best vergence separation and symptom totals over time. Settings has export/import for backups.

Calibrating with a bank card in Settings converts separations to millimeters and approximate prism diopters.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

Not medical advice. Use alongside the plan from your optometrist or vision therapist.
