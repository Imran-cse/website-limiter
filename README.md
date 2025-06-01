# Website Time Limiter

A Chrome extension that helps you manage your daily time spent on distracting websites. Track and limit the time you spend on specific websites to improve productivity and digital wellbeing.

## Features

- 🕒 Set custom daily time limits for any website
- 📊 Track time spent on each website
- 🔔 Get notified when approaching time limits
- 🚫 Automatic blocking when time limits are reached
- 📅 Daily reset of time counters at midnight
- 🔄 Real-time tracking of active tabs only
- 💪 Focus mode to better manage your browsing habits
- 📱 Works on any website, not just social media
- 🔌 Resilient connection handling with automatic recovery

## Installation

### From Chrome Web Store

1. Visit the Chrome Web Store (link to be added after publishing)
2. Search for "Website Time Limiter"
3. Click "Add to Chrome"
4. Follow the installation prompts

### From Source Code

1. Clone this repository: `git clone https://github.com/yourusername/website-time-limiter.git`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked" and select the extension folder
5. The extension is now installed and ready to use

## Usage

### Adding Websites to Track

- Click on the Website Time Limiter icon in your browser toolbar
- Click "Add Current Site" to track the website you're currently on
- OR - Enter a domain manually in the "Add New Website" section

### Setting Time Limits

- Select a website from the dropdown menu
- Enter your desired time limit in minutes (1-480)
- Click "Save Limit"

### Viewing Time Usage

- Open the extension popup to see time spent and remaining time for each website
- A progress bar shows your time usage visually
- Select different websites from the dropdown to view their stats

### When Time Limit is Reached

- You'll see a block page with a countdown until the time resets
- Time counters reset at midnight each day
- You can adjust your time limits from the extension settings

## How It Works

The extension tracks time only when:

- The website tab is active and visible
- You're actually interacting with the site
- The browser is in focus

Time tracking automatically pauses when you:

- Switch to another tab
- Minimize your browser
- Haven't interacted with the page for a while

## Privacy

This extension:

- Stores all data locally on your device
- Does not track browsing history beyond the domains you choose to limit
- Does not collect or transmit personal data
- Does not use analytics or tracking cookies

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

If you encounter any issues or have questions, please file an issue on the GitHub repository.

Take control of your online time and boost your productivity with Website Time Limiter!
