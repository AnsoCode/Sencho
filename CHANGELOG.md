# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
- **Changed:** Removed rigid volume sanitization, allowing full user control over bind paths.
- **Added:** Editable Host Volumes in the deployment UI.
- **Added:** Custom Environment Variable injection tool.
- **Fixed:** ScrollArea UI height rendering and dynamic browser timezone detection.
- **Changed:** Rebranded "Templates" to "App Store" across the UI.
- **Added:** Advanced deployment configuration panel (Editable Ports and Environment Variables) with smart defaults.
- **Fixed:** Implemented smart image fallbacks for broken registry logos and added expandable descriptions.
### Added
- **Added:** Official LinuxServer.io API integration as the default Template Registry.
- **Added:** Rich metadata display in the App Store (Architectures, Documentation links, GitHub repository links).
- **Added:** Dynamic Template Registry URL support via global settings, defaulting to LinuxServer.io templates.
- **Fixed:** Smart Volume Sanitizer to automatically rewrite messy Portainer bind mounts into clean, relative paths (Sencho 1:1 path rule).
- Git Flow branching strategy and branch protection.
- GitHub Actions CI pipeline for automated TypeScript build verification.
- **Added:** Automated Docker Hub CI/CD pipeline for the `dev` and `latest` tags.
- **Added:** App Templates (App Store) with One-Click deployment, utilizing Portainer v2 JSON registries and auto-generating compose files.
