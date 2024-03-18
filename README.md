# Behind the Curtain
A Firefox extension supposed to help you find the backend IP-Address of a website proxied by Cloudflare.  
Also allows you to gather a lot more information about the website, like querying info from [crt.sh](https://crt.sh),
[Shodan](https://shodan.io) and [IP-API](https://ip-api.com). 
On top of that, it also allows you to spoof the `Host` header of the request, which can be useful for pretending to 
use a different domain, for example when bypassing some Cloudflare protections.



## Credits:
#### The logo
A big special thank you to Skittles (`@skitsy.` on Discord, [`@skitty_skits` on Twitter](https://twitter.com/skitty_skits)) 
for creating the logo for this extension, both the one with Cloudflare enabled and the one with Cloudflare disabled.

#### MurmurHash3 library
I was reading the [Shodan blog on favicons](https://blog.shodan.io/deep-dive-http-favicon/) and I thought it would be 
interesting to create a browser extension that would hash the favicon of the current page and then search for it on Shodan.
After I started working on this, I checked if someone made a js library for murmurhash3 and I found out that someone
already made a browser extension that does exactly what I wanted to do! The extension is called `favicon-hash-browser-extension`, 
please check it out [here](https://github.com/michaelknap/favicon-hash-browser-extension), I only used the library for hashing from it:
https://github.com/michaelknap/favicon-hash-browser-extension/blob/main/src/lib/murmurhash3.js
This was after I did most code. I decided to implement it anyway, as I wanted to add a lot more to my extension anyway
than just hashing the favicon.
