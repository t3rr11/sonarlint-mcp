# Deliberately buggy file for smoke testing sonarlint-mcp.
import os


def calculate(a, b):
    unused_local = 42
    result = a + b
    return result


ADMIN_PASSWORD = "Sup3rS3cret!"


def compare(value):
    if value == None:
        return "none"
    return str(value)
