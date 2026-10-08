# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Entry point of a confined warm worker (see :mod:`.confinement`).

Started as ``python -I -m data_formulator.sandbox.confined_worker READ_FD WRITE_FD NETWORK``
under ``sandbox-exec`` or ``bwrap``; talks to the host over two inherited pipes.
"""

import sys


def main() -> None:
    from multiprocessing.connection import Connection

    from .local_sandbox import DuplexConnection, _warm_worker_loop

    read_fd, write_fd, network = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3] == "1"
    connection = DuplexConnection(Connection(read_fd, writable=False), Connection(write_fd, readable=False))
    _warm_worker_loop(connection, allow_network=network, announce_ready=True)


if __name__ == "__main__":
    main()
