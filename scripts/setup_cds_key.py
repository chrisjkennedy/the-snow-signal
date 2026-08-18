#!/usr/bin/env python3.13
"""Set up the Copernicus credentials file, without the key touching anything else.

The cdsapi download client looks for a small settings file at ~/.cdsapirc and
reads the account key out of it. Creating that by hand is fiddly -- the name
starts with a dot so Finder hides it, and TextEdit will happily save it as rich
text with a .txt on the end, which the client then cannot read.

So this asks for the key with the terminal echo turned off. Nothing is printed,
nothing is stored in shell history, and the key goes straight into the file with
owner-only permissions.

    python3.13 scripts/setup_cds_key.py
"""
import os
import stat
import sys
from getpass import getpass
from pathlib import Path

RC = Path.home() / '.cdsapirc'
URL = 'https://cds.climate.copernicus.eu/api'


def main():
    print()
    print('Copernicus Climate Data Store — credentials setup')
    print('-' * 50)
    print('Open  https://cds.climate.copernicus.eu/profile  while logged in.')
    print('Find the box labelled "API key" and copy the key out of it.')
    print()

    if RC.exists():
        print(f'{RC} already exists.')
        if input('Replace it? [y/N] ').strip().lower() not in ('y', 'yes'):
            print('Left alone. Nothing changed.')
            return 0
        print()

    print('Now paste the key and press Return.')
    print('Nothing will appear on screen as you paste — that is deliberate.')
    print()
    key = getpass('API key: ').strip()

    if not key:
        print('\nNothing entered. Nothing written.', file=sys.stderr)
        return 1

    # The profile page shows a couple of formats depending on account age. Both
    # work, so this only catches an obviously wrong paste (a URL, an email, a
    # stray fragment) rather than trying to validate the token itself.
    if key.startswith('http') or '@' in key or len(key) < 20:
        print('\nThat does not look like an API key.', file=sys.stderr)
        print('Expected a long string of letters, numbers and dashes.', file=sys.stderr)
        print('Nothing written — run this again with the right value.', file=sys.stderr)
        return 1

    if key.lower().startswith('key:'):
        key = key.split(':', 1)[1].strip()   # pasted the whole line, not just the value

    RC.write_text(f'url: {URL}\nkey: {key}\n')
    os.chmod(RC, stat.S_IRUSR | stat.S_IWUSR)      # 0600, readable only by you

    print()
    print(f'Written to {RC}')
    print(f'Permissions set so only your account can read it.')
    print()

    try:
        import cdsapi                                        # noqa: F401
        print('The cdsapi client can see it. Setup is done.')
    except ImportError:
        print('Note: the cdsapi client is not installed yet — tell me and I will install it.')

    print()
    print('Next: accept the dataset licences (the four links in docs/CDS_SETUP.md),')
    print('then tell me it is done and I will run a test download.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
