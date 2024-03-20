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
    if (new RegExp('https?://(www\\.)?shodan\\.io/domain/.*').test(tab.url)) {
        // Check if the extension is already editing the table
        browser.tabs.executeScript(tabId, {code: 'document.getElementById("btc-updating")'}).then(el => {
            if (el[0]) {
                return;
            }

            // Add some kind of info that the extension is already editing the table
            browser.tabs.executeScript(tabId, {code: `(function() {
                let el = document.createElement('div');
                el.id = 'btc-updating';
                el.hidden = true;
                document.body.appendChild(el);
                return undefined;
            })()`}).then(() => {});

            /* get the table by running document.querySelector('#domain > :first-child > :first-child > table') IN the tab */
            browser.tabs.executeScript(tabId, {code: 'document.querySelector("#domain > :first-child > :first-child > table").outerHTML'}).then(async table => {
                if (!table[0]) {
                    return;
                }
                /* parse the table */
                let parser = new DOMParser();
                let doc = parser.parseFromString(table[0], 'text/html');
                let rows = doc.querySelectorAll('tr');
                /* The second element of the row is the record type, check if it's an A / AAAA record */
                let unproxied = []
                for (let row of rows) {
                    // Add a cell at the beginning of the row
                    row.insertCell(0);
                    row.children[0].style.paddingRight = '10px';
                    row.children[0].style.paddingLeft = '10px';
                    row.children[0].width = '20';
                    let domain = row.children[1].innerText;
                    row.children[1].style.paddingLeft = '0';
                    if (row.children[2].innerText === 'A' || row.children[2].innerText === 'AAAA') {
                        // ip: row.children[3].innerText -> first child -> first child -> text
                        let ip = row.children[3].children[0].children[0].innerText;
                        /* check if it's cloudflare */
                        let is_cf = await isCloudflareIP(ip)
                        // Change the text of the cell to the cloudflare status
                        row.children[0].innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="10 0 76 39.5" width="20" height="20" style="vertical-align: middle;">
                                <style>
                                    .logoUnproxied {
                                        fill: #92979b;
                                    }
                                    .logoProxied {
                                        fill: #f38020;
                                    }
                                </style>
                                <path id="cfLogoPath" class="${is_cf ? 'logoProxied' : 'logoUnproxied'}" 
                                    d="M74.5,39c-2.08,0-15.43-.13-28.34-.25-12.62-.12-25.68-.25-27.66-.25a8,8,0,0,1-1-15.93c0-.19,0-.38,0-.57a9.49,9.49,0,0,1,14.9-7.81,19.48,19.48,0,0,1,38.05,4.63A10.5,10.5,0,1,1,74.5,39Z"/>
                            </svg>
                        `
                        if (!is_cf && domain !== '*' && unproxied.indexOf(domain) === -1 && domain !== '') {
                            unproxied.push(domain);
                        }
                    }
                }
                // Update the table with the new cell
                let newTable = doc.querySelector('table').outerHTML;
                browser.tabs.executeScript(tabId, {code: `document.querySelector("#domain > :first-child > :first-child > table").outerHTML = ${JSON.stringify(newTable)}`}).then(() => {});

                // Add a new div with the unproxied domains
                browser.tabs.executeScript(tabId, {code: 'document.querySelector("#domain > :first-child > :nth-child(2)").outerHTML'}).then(div => {
                    if (!div[0]) {
                        return;
                    }
                    let parser = new DOMParser();
                    let doc = parser.parseFromString(div[0], 'text/html');
                    // Get nth-child(2) of the first child of the div
                    let newElement = doc.createElement('div');
                    newElement.innerHTML = `
                        <div class="card card-padding card-orange">
                            <div class="card-header">
                                <h1>
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="10 0 76 39.5" style="vertical-align: middle" width="20" height="20">
                                        <path id="cfLogoPath" fill="currentColor"
                                            d="M74.5,39c-2.08,0-15.43-.13-28.34-.25-12.62-.12-25.68-.25-27.66-.25a8,8,0,0,1-1-15.93c0-.19,0-.38,0-.57a9.49,9.49,0,0,1,14.9-7.81,19.48,19.48,0,0,1,38.05,4.63A10.5,10.5,0,1,1,74.5,39Z"/>
                                    </svg>
                                    <em>Unproxied</em>domains
                                </h1>
                            </div>
                            <ul style="list-style-position: inside; list-style-type: circle;">
                                ${unproxied.map(domain => `<li style="display: list-item; list-style-type: disc;">${domain}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                    doc.body.getElementsByTagName('div')[0].appendChild(newElement);
                    browser.tabs.executeScript(tabId, {code: `document.querySelector("#domain > :first-child > :nth-child(2)").outerHTML = ${JSON.stringify(doc.body.innerHTML)}`}).then(() => {});
                });
            }).catch(() => {});
        }).catch(() => {});
    }
});


function setData(dnsInfo, hostname, tabId) {
    isCloudflareIP(dnsInfo.addresses[0]).then(isCloudflare => {
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