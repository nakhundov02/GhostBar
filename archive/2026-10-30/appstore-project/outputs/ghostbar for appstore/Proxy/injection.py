"""Pure HTML transformation. No browser-specific behavior or credential storage."""
import json
import re
import secrets

MAX_HTML_BYTES = 2 * 1024 * 1024


def update_csp(policy, nonce):
    directives = {}
    for part in policy.split(';'):
        words = part.strip().split()
        if words and words[0].lower() not in directives:
            directives[words[0].lower()] = words[1:]
    if 'sandbox' in directives:
        return None
    for name, fallback in [('script-src', 'default-src'), ('script-src-elem', 'script-src'),
                           ('style-src', 'default-src'), ('style-src-elem', 'style-src')]:
        if name.endswith('-elem') and name not in directives:
            continue
        if name not in directives and fallback not in directives:
            continue
        values = list(directives.get(name, directives.get(fallback, [])))
        values = [v for v in values if v != "'none'"]
        values.append("'nonce-" + nonce + "'")
        directives[name] = list(dict.fromkeys(values))
    if 'connect-src' in directives or 'default-src' in directives:
        values = [v for v in directives.get('connect-src', directives.get('default-src', [])) if v != "'none'"]
        directives['connect-src'] = list(dict.fromkeys(values + ["'self'"]))
    return '; '.join(' '.join([name] + values) for name, values in directives.items())


def transform(html, script, session, endpoint, policies=()):
    if len(html.encode('utf-8')) > MAX_HTML_BYTES or 'ghostbar-root' in html:
        return None
    # A meta policy may impose a second, stricter policy. Keep that page intact.
    if re.search(r'<meta\b[^>]*http-equiv\s*=\s*[\"\']?content-security-policy', html, re.I):
        return None
    nonce = secrets.token_urlsafe(24)
    adjusted = [update_csp(p, nonce) for p in policies]
    if any(p is None for p in adjusted):
        return None
    config = json.dumps({'session': session, 'endpoint': endpoint, 'nonce': nonce}, separators=(',', ':'))
    config = config.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    executable = script.replace('__GHOSTBAR_CONFIG__', config).replace('</script', '<\\/script')
    insertion = '<script nonce="' + nonce + '">' + executable + '</script>'
    closing = list(re.finditer(r'</body\s*>', html, re.I))
    index = closing[-1].start() if closing else len(html)
    return html[:index] + insertion + html[index:], adjusted
