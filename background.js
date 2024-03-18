async function getCloudflareIPRanges() {
    let cloudflareIPRanges = [];

    let response = await fetch('https://api.cloudflare.com/client/v4/ips', {headers: {'skip-spoof': 'true'}});
    let data = await response.json();
    let ranges = data.result.ipv4_cidrs;
    for (let range of ranges) {
        let [start, end] = ipv4CidrToRange(range);
        cloudflareIPRanges.push([start, end]);
    }
    ranges = data.result.ipv6_cidrs;
    for (let range of ranges) {
        let [start, end] = ipv6CidrToRange(range);
        cloudflareIPRanges.push([start, end]);
    }

    return cloudflareIPRanges;
}

function ipv4ToUint32(ip) {
    let parts = ip.split('.');
    return (parseInt(parts[0]) << 24) +
        (parseInt(parts[1]) << 16) +
        (parseInt(parts[2]) << 8) +
        parseInt(parts[3]) >>> 0;
}

function normalizeIPv6(ipv6) {
    let bp = ipv6.split(/::/g);
    if (bp.length > 2) {
        return null; // Invalid IPv6 address
    }
    let parts = [];
    if (bp.length === 1) {
        parts = bp[0].split(':');
        if (parts.length !== 8) {
            return null; // Invalid IPv6 address
        }
    } else {
        let parts1 = bp[0].split(':');
        let parts2 = bp[1].split(':');
        if (parts1.length + parts2.length > 8) {
            return null; // Invalid IPv6 address
        }
        for (let part of parts1) {
            parts.push(part);
        }
        for (let i = 0; i < 8 - parts1.length - parts2.length; i++) {
            parts.push('0000');
        }
        for (let part of parts2) {
            parts.push(part);
        }
    }
    return parts.map(part => part.padStart(4, '0')).join(':');
}


function ipv6ToUint128(ipv6) {
    // Split IPv6 address into its individual components
    const parts = normalizeIPv6(ipv6).split(':');

    // Convert each component to its hexadecimal value and join them
    return BigInt('0x' + parts.map(part => parseInt(part, 16).toString(16).padStart(4, '0')).join(''));
}

function ipv4CidrToRange(cidr) {
    let [ip, mask] = cidr.split('/');
    let ipUint32 = ipv4ToUint32(ip);
    let maskUint32 = (1 << (32 - mask)) - 1;
    let start = (ipUint32 & ~maskUint32) >>> 0; // Convert to unsigned
    let end = (ipUint32 | maskUint32) >>> 0; // Convert to unsigned
    return [start, end];
}

function ipv6CidrToRange(cidr) {
    let [ip, mask] = cidr.split('/');
    let ipUint128 = ipv6ToUint128(ip);
    let maskUint128 = (BigInt(1) << (BigInt(128) - BigInt(mask))) - BigInt(1);
    let start = ipUint128 & ~maskUint128;
    let end = ipUint128 | maskUint128;
    return [start, end];
}

getCloudflareIPRanges().then((cloudflareIPRanges) => {
    console.log('Cloudflare IP ranges loaded');
    // Delete the all data from the storage
    browser.storage.local.clear().then(() => {
        // Save the IP ranges to the storage
        browser.storage.local.set({cloudflareIPRanges: cloudflareIPRanges});
    });
});


async function isCloudflareIP(ip) {
    let ipAsInt = 0;
    if (ip.includes(':')) {
        ipAsInt = ipv6ToUint128(ip);
    } else {
        ipAsInt = ipv4ToUint32(ip);
    }
    for (let [start, end] of (await browser.storage.local.get('cloudflareIPRanges')).cloudflareIPRanges) {
        if (ipAsInt >= start && ipAsInt <= end) {
            return true;
        }
    }

    return false;
}


/* tab reloaded/changed/whatnot logic */
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    /* get the dns info and check if it's cloudflare */
    browser.dns.resolve(new URL(tab.url).hostname, ["disable_ipv6"]).then(dnsInfo => {
        setData(dnsInfo, new URL(tab.url).hostname, tabId);
    }).catch(() => {
        /* if the DNS resolution fails, try again with IPv6 enabled */
        browser.dns.resolve(new URL(tab.url).hostname, []).then(dnsInfo => {
            setData(dnsInfo, new URL(tab.url).hostname, tabId);
        });
    });
})


function setData(dnsInfo, hostname, tabId) {
    let isCloudflare = isCloudflareIP(dnsInfo.addresses[0]).then(isCloudflare => {
        /* if it's cloudflare, change the icon of the extension */
        if (isCloudflare) {
            browser.browserAction.setIcon({tabId: tabId, path: "icons/proxied.png"});
        }
        // Save the IP address and CF status to the storage, associate it with the hostname
        browser.storage.local.get('hostData').then(hostData => {
            if (!hostData.hostData) {
                hostData.hostData = {};
            }
            hostData.hostData[hostname] = {ip: dnsInfo.addresses[0], isCloudflare: isCloudflare};
            browser.storage.local.set({hostData: hostData.hostData});
        });
    });
}

browser.webRequest.onBeforeSendHeaders.addListener(
    // Host spoofing
    async function (details) {
        let headers = details.requestHeaders;
        if (headers.some(header => header.name.toLowerCase() === 'skip-spoof')) {
            return {requestHeaders: headers};
        }
        for (let header of headers) {
            if (header.name.toLowerCase() === 'host') {
                let spoofedHost = (await browser.storage.local.get("hostSpoof")).hostSpoof[
                        await browser.tabs.query({active: true, currentWindow: true}).then(tabs => tabs[0].id)
                    ];
                if (spoofedHost) {
                    header.value = spoofedHost;
                    headers = headers.filter(h => h.name.toLowerCase() !== 'alt-used');
                    return {requestHeaders: headers};
                }
            }
        }
    },
    {urls: ['<all_urls>']},
    ['blocking', 'requestHeaders']
);