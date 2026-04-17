# Demo Assets

Replace `siglume-owner-publish-demo.gif` with the captured 8-10 second README
loop after you record the full demo.

From the SDK root, run:

```powershell
powershell -File .\scripts\make-demo-gif.ps1 -InputFile .\siglume-demo-90s.mp4
```

The script writes the GIF back to this directory at `siglume-owner-publish-demo.gif`, so the README picks it up automatically.
