# Dubbing Tool

## Overview
The Dubbing Tool is a web application that allows users to upload WAV audio files and a text document containing transcripts and translations. The tool processes these files and enables users to generate new audio recordings based on the provided transcripts.

## Project Structure
```
dubbing-tool
├── public
│   └── index.html        # HTML structure for the web tool
├── src
│   ├── app.js           # Main application logic
│   ├── index.js         # Entry point for the application
│   ├── styles.css       # CSS styles for the web tool
│   └── utils
│       └── transcriptParser.js # Utility for parsing transcripts
├── package.json          # npm configuration file
└── README.md             # Project documentation
```

## Installation
1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```
   cd dubbing-tool
   ```
3. Install the dependencies:
   ```
   npm install
   ```

## Usage
1. Start the application:
   ```
   npm start
   ```
2. Open your web browser and go to `http://localhost:3000` (or the specified port).
3. Upload your WAV files and the corresponding text document.
4. Use the interface to manage audio recordings and generate new dubbing files.

## Features
- Upload multiple WAV files.
- Upload a text document with transcripts and translations.
- Play, record, and manage audio files.
- Download generated dubbing results as ZIP files.

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.