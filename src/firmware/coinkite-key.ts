/**
 * Coinkite's release-signing key: Peter D. Gray <peter@coinkite.com>.
 *
 * It signs `signatures.txt`, the SHA-256 list of every official Coldcard firmware file.
 * Pinned here rather than fetched, so no server this page talks to can substitute one.
 * The fingerprint is checked against the key block before the key is used, so the two
 * cannot drift apart. Cross-check it with Coinkite's own publications and a keyserver:
 *
 *   https://keys.openpgp.org/search?q=4589779ADFC14F3327534EA8A3A31BAD5A2A5B10
 */
export const COINKITE_FINGERPRINT = '4589779adfc14f3327534ea8a3a31bad5a2a5b10';

export const COINKITE_SIGNER = 'Peter D. Gray (Coinkite)';

export const COINKITE_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----
Comment: 4589 779A DFC1 4F33 2753  4EA8 A3A3 1BAD 5A2A 5B10
Comment: Peter D. Gray <peter@coinkite.com>

xsBNBFJ8Ct4BCAC5jlWYlkqNQsiyt63Hothb2W1+DUH+19C2qGg54PG0wV//yAaL
xhpxejQogYZ415fYM1NHBf+vCbvbwn6yfrO8kSLj+EFVaob2io6GoG3N9Ftzeljs
U5dsUaAwxNV/bHHTt9vi5GQRAvMZYDLWwNZ+ET476gEYt8q0VX/PojowHZ4gD0Cj
UxtOh+2zk2jAGZ9MpX/9IXxfNQ9Y3kBE8ZB1KHzuFM4WsfO08uMV0wCZ6HOsgauv
bG+7JQakcpWcA7OdkNJdwkjrDtB2Cv9xedUSTzROmJhIQ3xkRI0+7Dh/pb1qwoHZ
Aj+Ve1RwZtxAGuGzk6b3ZFcJ8ey7AptwKr9VABEBAAHNIlBldGVyIEQuIEdyYXkg
PHBldGVyQGNvaW5raXRlLmNvbT7CwJQEEwEKACcFAlJ8Ct4CGwMFCS0kvQAFCwkI
BwMFFQoJCAsFFgIDAQACHgECF4AAIQkQo6MbrVoqWxAWIQRFiXea38FPMydTTqij
oxutWipbED6pCACaPoFwbxn/Q3h9EDIgDn4afg2atPLfn+92ynqj2JAcHcDoDuMc
f162p7ConM8YQkMpwlLwhcjpLEOga1reI583Y6K6lwhHHsoPr2Pb4r6nxlmJdxTW
g899WZWuT9Jjjqei9WpjArkm0TRdEn0527rEfWqfCQrV2w1oO9WpkBHiQMRcD7jY
ctaFDsqng2d2NPI9cj8lytHGfiESIa4ttHDC+ocDYSk7mjbJvnXf8EcJNgQwnZYg
E+JAi6+TWSm0GAsxhnMij9Mf3RYrGimCTG4mqApUnb38TyR05JRvRZk3KR1qp32d
cqMlwicHLw7jVzKGyMFyjBIkBQNVF9PAZRtBzsBNBFJ8Ct4BCACxB5MiGgjXi85b
ezAUpTo187qxRFvibFNkEmYav5CoyN5TDjzPc85pYWagIKr9mRx9WprtGlSdjont
Jm+FRe10In/Kf9Ok87dfz8g3INQE9aWHvvHBh+Mee6RQrjKjA7GM3YW6fZOl218b
EXaIGgHBFUG/TjH8xNAB5AVP5HYq1Ja/lppgFrF7t8S2jtlM05fI9j4Stm+2rYHP
rjZ6VSivj7hcc39a4/0SZ/hAtSgp+uAaI87LyVo+irlcNCiNE+/KRhUzoXJ16rKv
gJJtJoDRFYz69a0dHH++cCMEQiUD0QvLoMb1FjqH8k6S+sMuYy7kDtDQRaJDWOQI
CILVivvVABEBAAHCwHwEGAEKAA8FAlJ8Ct4CGwwFCS0kvQAAIQkQo6MbrVoqWxAW
IQRFiXea38FPMydTTqijoxutWipbEIwECACm3Qv8VJXMX268ADmxLXWoDonlts7h
wl4rVBQe97GilngLdh99UEf/u0jE6EFF/PgSE09JAcABi8jsxzIWfhrvpRDCaoSG
JgnX2+3Z7DYejSqcdY9DDDvOxSFWuheR3M48IH8rASnEKGZ5dmHKQC+7J7x8N4zV
ckkFUmJrFkomENhIahP6wC1qy6roip3qWZG3m1/Z9u6MuktWo0g/t59iumCZNqQ/
VqSCl0sAPovY062WN5GmOqs90hQFe67oYRbq7DAR5pZqjw7NV22hbuFK8xfFjp7t
O2MONxe5a6cfHGCLmGXM0jqEJzu4GVvdkBkx5zEkiHytA9yzCp/zil3w
=qlxB
-----END PGP PUBLIC KEY BLOCK-----`;
