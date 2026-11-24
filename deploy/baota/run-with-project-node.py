#!/usr/bin/env python3
"""Run maintenance scripts with the Node version selected in BaoTa."""

import argparse
import os
from pathlib import Path
import re
import sys


def project_node():
    panel_dir = Path('/www/server/panel')
    os.chdir(str(panel_dir))
    sys.path.insert(0, str(panel_dir / 'class'))
    from projectModel.nodejsModel import main

    project = main().get_project_find('smsbazaar')
    if not project:
        raise RuntimeError('BaoTa project smsbazaar is not configured')
    version = project['project_config']['nodejs_version']
    if not re.fullmatch(r'v\d+\.\d+\.\d+', version):
        raise RuntimeError('Unexpected Node version in BaoTa project configuration')
    node = Path('/www/server/nodejs') / version / 'bin/node'
    if not node.is_file() or not os.access(str(node), os.X_OK):
        raise RuntimeError('Configured Node executable is missing')
    return node


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', action='store_true')
    parser.add_argument('script', nargs='?')
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    node = project_node()
    if args.version:
        print(str(node))
        return
    if not args.script:
        parser.error('a script path is required')
    os.chdir('/www/wwwroot/smsbazaar')
    os.execv(str(node), [str(node), args.script, *args.arguments])


if __name__ == '__main__':
    main()
