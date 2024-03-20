'use strict';

async function getFaviconUrl() {
    // Get all the favicons in the currently opened tab, DO NOT get the popup.html favicon
    let tab = (await browser.tabs.query({active: true, currentWindow: true}))[0];
    let favicons = (await browser.tabs.executeScript(tab.id, {
        code: 'Array.from(document.querySelectorAll(\'link[rel^="icon"], link[rel*=" icon"]\')).map((link) => link.href);'
    }))[0];
    // select the last favicon
    if (favicons.length > 0) {
        return favicons[favicons.length - 1];
    }
    // If no favicon is found, check if the website has a favicon.ico
    let url = new URL(tab.url).origin + '/favicon.ico';
    let response = await fetch(url, {method: 'HEAD', cache: 'no-store', headers: {'skip-spoof': 'true'}});
    if (response.ok) {
        return url;
    }
    return null;
}

async function getFaviconHash() {
    let url = await getFaviconUrl();
    if (url === null) {
        return null;
    }
    let response = await fetch(url, {cache: 'no-store', headers: {'skip-spoof': 'true'}});
    let buffer = await response.arrayBuffer();

    const uint8Array = new Uint8Array(buffer);

    let base64data = '';
    for (let i = 0; i < uint8Array.length; i++) {
        base64data += String.fromCharCode(uint8Array[i]);
    }

    const base64String = btoa(base64data);

    let base64_with_newlines = (base64String.match(/.{1,76}/g) || []).join('\n');

    if (!base64_with_newlines.endsWith('\n')) {
        base64_with_newlines += '\n';
    }

    return mmh3_32(base64_with_newlines);
}


function setIPAPIInfo(data) {
    document.getElementById('ipInfo').hidden = false;
    if (data.status === "fail") {
        document.getElementById('ipInfo').innerText = 'No information available';
        return;
    }
    let ipInfoHTML = "";
    let as = data.as.split(' ')[0];
    ipInfoHTML += `Country: ${data.country} (${data.countryCode})<br>`;
    ipInfoHTML += `Region: ${data.regionName} (${data.region})<br>`;
    ipInfoHTML += `City: ${data.city} (${data.zip})<br>`;
    ipInfoHTML += `Location: <a href="https://www.google.com/maps?q=${data.lat},${data.lon}" target="_blank">${data.lat}, ${data.lon}</a><br>`;
    ipInfoHTML += `ISP: ${data.isp} (<a href="https://ipinfo.io/${as}" target="_blank">${as}</a>)<br>`;
    if (data.org !== data.isp) {
        ipInfoHTML += `Organization: ${data.org}<br>`;
    }

    document.getElementById('ipInfoDetails').innerHTML = ipInfoHTML;
}

function setIpData(isCloudflare, ip, tab) {
    document.getElementById('viewOnIpinfo').href = `https://ipinfo.io/${ip}`;

    let hostname = new URL(tab.url).hostname;
    if (hostname.startsWith('www.')) {
        hostname = hostname.slice(4);
    }
    // Remove the port number from the hostname
    hostname = hostname.split(':')[0];
    fetch(`https://crt.sh/?output=json&q=${hostname}`, {headers: {'skip-spoof': 'true'}}).then(response => response.json()).then((data) => {
        let subdomains = new Set();
        for (let cert of data) {
            cert.name_value.split('\n').forEach((name) => {subdomains.add(name)});
        }
        subdomains = Array.from(subdomains).sort((a, b) => {
            return a.split('.').length - b.split('.').length || a.localeCompare(b);
        });
        let subdomainsHTML = "";
        for (let subdomain of subdomains) {
            // We can assume it's HTTPS because there's literally a certificate for it
            subdomainsHTML += `<li><a href="https://${subdomain}" target="_blank">${subdomain}</a></li>`;
        }
        if (subdomainsHTML === "") {
            subdomainsHTML = "No subdomains found";
        } else {
            subdomainsHTML = `<ul>${subdomainsHTML}</ul>`;
        }
        document.getElementById('subdomains').innerHTML = subdomainsHTML;
    });
    if (isCloudflare) {
        document.getElementById('isCloudflare').innerHTML = 'This website is proxied over Cloudflare<br>';
        document.getElementById('isCloudflare').style.color = '#f68a28';
        document.getElementById('cfLogoPath').classList.remove('logoUnproxied');
        document.getElementById('cfLogoPath').classList.add('logoProxied');
        fetch(new URL(tab.url).origin + '/cdn-cgi/trace', {headers: {'skip-spoof': 'true'}}).then(response => response.text()).then((text) => {
            let lines = text.split('\n');
            let data = {};
            for (let line of lines) {
                let [key, value] = line.split('=');
                data[key] = value;
            }
            document.getElementById('cfInfo').innerHTML =
                `Connected to Cloudflare ${data.loc}, ${capitalizeFirstLetter(data.colo)}<br>(${ip})`;
        });
        return;
    }
    document.getElementById('isCloudflare').innerHTML = 'This website is not proxied over Cloudflare';
    document.getElementById('isCloudflare').style.color = '#656565';
    document.getElementById('ip').innerHTML = ip;
    document.getElementById('viewOnShodan').href = `https://www.shodan.io/host/${ip}`;
    document.getElementById('viewOnIpinfo').href = `https://ipinfo.io/${ip}`;
    document.getElementById('viewOnIpinfo').hidden = false;
    document.getElementById('viewOnShodan').hidden = false;
    fetch(`https://internetdb.shodan.io/${ip}`, {headers: {'skip-spoof': 'true'}}).then(response => response.json()).then((data) => {
        setIDBInfo(data)
    })
    fetch(`http://ip-api.com/json/${ip}`, {headers: {'skip-spoof': 'true'}}).then(response => response.json()).then((data) => {
        setIPAPIInfo(data)
    });
}

function capitalizeFirstLetter(string) {
    string = String(string)
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

function snakeCaseToTitle(string) {
    return string.split('_').map(word => capitalizeFirstLetter(word)).join(' ');
}

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

document.getElementById("spoofButton").addEventListener("click", async () => {
    console.log("Form submitted");
    let wantedHost = document.getElementById("hostSpoof").value;
    // Save to local storage
    let tabID = (await browser.tabs.query({active: true, currentWindow: true}))[0].id
    let oldHostSpoof = await browser.storage.local.get("hostSpoof")
    oldHostSpoof = oldHostSpoof.hostSpoof || {};
    oldHostSpoof[tabID] = wantedHost;
    await browser.storage.local.set({hostSpoof: oldHostSpoof});
    // Reload the tab
    browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
        let tab = tabs[0];
        browser.tabs.reload(tab.id);
    });
});

// add a listener if enter is pressed in the input field, because forms are weird in popups
document.getElementById("hostSpoof").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        event.preventDefault();
        document.getElementById("spoofButton").click();
    }
});


getFaviconHash().then((hash) => {
    if (hash === null) {
        document.getElementById('faviconHash').innerText = 'No favicon found';
    } else {
        document.getElementById('faviconHash').innerHTML =
            `<a href="https://www.shodan.io/search?query=http.favicon.hash:${hash}" target="_blank">${hash}</a>`;
    }
});


browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
    let tab = tabs[0];
    let hostname = new URL(tab.url).hostname;
    if (hostname.startsWith('www.')) {
        hostname = hostname.slice(4);
    }
    // Remove the port number from the hostname
    hostname = hostname.split(':')[0];

    // Check if the hostname is an IP address or a domain
    if (hostname.match(/^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/)) {
        document.getElementById('hostname').innerText = 'N/A';
    } else {
        document.getElementById('viewDomainOnShodan').href = `https://www.shodan.io/domain/${hostname}`;
        document.getElementById('viewDomainOnCrt').href = `https://crt.sh/?q=${hostname}`;
        document.getElementById('viewDomainOnShodan').hidden = false;
        document.getElementById('viewDomainOnCrt').hidden = false;

        document.getElementById('hostname').innerHTML =
         `<a href='https://www.shodan.io/search?query=-org:"Cloudflare++Inc."+hostname:"${hostname}"' target="_blank">${hostname}</a>`;
    }

    browser.storage.local.get("hostSpoof").then(async (hostSpoof) => {
        hostSpoof = hostSpoof.hostSpoof || {};
        let currentHostname = hostSpoof[tab.id];
        if (currentHostname !== undefined) {
            document.getElementById("hostSpoof").value = currentHostname;
        }
    });

    // Get the CF Data from the storage
    browser.storage.local.get('hostData').then(hostData => {
        if (hostData.hostData === undefined) {
            hostData.hostData = {};
        }
        let data = hostData.hostData[new URL(tab.url).hostname];
        if (data !== undefined) {
            setIpData(data.isCloudflare, data.ip, tab);
            return
        }

        browser.dns.resolve(new URL(tab.url).hostname).then(dnsInfo1 => {
            isCloudflareIP(dnsInfo1.addresses[0]).then(isCloudflare => {
                if (isCloudflare) {
                    setIpData(isCloudflare, dnsInfo1.addresses[0], tab);
                    return;
                }

                // If not cloudflare and it's an IPv6, try to get the IPv4 address only
                // Return if it's an IPv4 address
                if (!dnsInfo1.addresses[0].includes(':')) {
                    setIpData(isCloudflare, dnsInfo1.addresses[0], tab);
                    return;
                }

                // Try to get the IPv4 address
                browser.dns.resolve(new URL(tab.url).hostname, ["disable_ipv6"]).then(dnsInfo2 => {
                    setIpData(isCloudflare, dnsInfo2.addresses[0], tab);
                }).catch(() => {
                    // if the IPv4 resolution fails, use the IPv6 address
                    browser.dns.resolve(new URL(tab.url).hostname).then(dnsInfo3 => {
                        setIpData(isCloudflare, dnsInfo1.addresses[0], tab);
                    });
                });
            });
        })
    });
});


function setIDBInfo(data) {
    document.getElementById('osInfo').hidden = false;
    document.getElementById('servicesInfo').hidden = false;
    if (data.detail === "No information available") {
        document.getElementById('hostInfo').innerText = 'No information available';
        return;
    }
    let operatingSystems = "";
    for (let cpe of data.cpes) {
        if (cpe.startsWith('cpe:/o:')) {
            operatingSystems += `${snakeCaseToTitle(cpe.split(':')[3])} (${snakeCaseToTitle(cpe.split(':')[2])}), `;
        }
    }
    operatingSystems = operatingSystems.slice(0, -2);
    if (operatingSystems === "") {
        operatingSystems = "Not detected";
    }
    document.getElementById('operatingSystem').innerText = operatingSystems;

    let servicesHTML = "";
    for (let service of data.cpes) {
        if (service.startsWith('cpe:/a:')) {
            servicesHTML += `<li>${snakeCaseToTitle(service.split(':')[3])} (${snakeCaseToTitle(service.split(':')[2])})</li>`;
        }
    }
    if (servicesHTML === "") {
        servicesHTML = "None detected";
    } else {
        servicesHTML = `<ul>${servicesHTML}</ul>`;
    }
    document.getElementById('services').innerHTML = servicesHTML;

    let portHTML = "Ports:<br>";
    for (let port of data.ports) {
        if (port === 80 || port === 443) {
            portHTML += `<div class="port">
                <a href="http${port === 443 ? 's' : ''}://${data.ip}:${port}" target="_blank">${port}</a> `;
        } else {
            portHTML += `<div class="port">${port} `;
        }
        portHTML += `<a class="shodanService" href="https://www.shodan.io/host/${data.ip}#${port}" target="_blank">(Shodan)</a></div>`;
    }
    document.getElementById('ports').innerHTML = portHTML;
}