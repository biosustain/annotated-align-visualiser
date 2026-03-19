# Annotated Alignment Visualiser

A Vue 3 + Vite web application for visualizing DNA sequence alignment traces. Renders trace data with Plotly.js, including base call quality and alignment mismatches.

## Features

- 📊 Interactive Plotly.js visualization
- 📁 Upload JSON alignment files
- 📥 Load example data from GEAR genomics API
- 🔍 Zoom and pan with rangeslider
- 🎨 Color-coded nucleotide peaks (A/C/G/T)
- ❌ Highlight alignment mismatches
- 📱 Responsive design
- ⚡ Fast, built with Vite

## Development

### Prerequisites
- Node.js 16+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

The development server will run at `http://localhost:5173`

## Deployment to GitHub Pages

### 1. Update Repository Settings

1. Push your code to GitHub
2. Go to repository **Settings** → **Pages**
3. Set **Source** to "GitHub Actions"

### 2. Automatic Deployment

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) will automatically:
- Build the Vue app with Vite
- Deploy to GitHub Pages on every push to `main`

### 3. Access Your App

Your app will be available at:
```
https://YOUR_USERNAME.github.io/annotated-align-visualiser/
```

### Manual Deployment (if needed)

```bash
# Build the project
npm run build

# The 'dist' folder is ready to deploy
```

Then manually upload the `dist` folder contents to your hosting service.

## Project Structure

```
├── src/
│   ├── main.js           # App entry point
│   ├── App.vue           # Root Vue component
│   └── renderer.js       # Plotly rendering logic
├── index.html            # HTML template
├── vite.config.js        # Vite configuration
├── package.json          # Dependencies
└── .github/workflows/    # GitHub Actions
```

## Data Format

The app expects JSON files matching the Tracy/GEAR alignment format:

```json
{
  "refchr": "chr1",
  "refpos": 100,
  "forward": true,
  "gappedTrace": {
    "peakA": [...],
    "peakC": [...],
    "peakG": [...],
    "peakT": [...],
    "basecallPos": [...],
    "basecallQual": [...],
    "basecalls": {...},
    "leadingGaps": 0
  },
  "refalign": [...]
}
```

## License

MIT