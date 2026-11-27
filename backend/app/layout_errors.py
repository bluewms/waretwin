"""Workspace layout errors shared by stores and routes (no third-party imports)."""


class LayoutNotFound(LookupError):
    pass


class LayoutConflict(ValueError):
    pass


class LayoutInvalid(ValueError):
    def __init__(self, issues):
        super().__init__('Layout validation failed')
        self.issues = issues
