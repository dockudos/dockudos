{
  "name": "{{slug}}",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "dockudos dev",
    "build": "dockudos build",
    "start": "next start",
    "broken-links": "dockudos broken-links",
    "pdf": "dockudos pdf"
  },
  "dependencies": {
    "@dockudos/core": "{{version}}",
    "@dockudos/next": "{{version}}",
    "@dockudos/ui": "{{version}}",
    "next": "{{nextVersion}}",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@dockudos/cli": "{{version}}",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "~6.0.3"
  }
}
