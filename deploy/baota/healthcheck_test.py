import contextlib
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('healthcheck', Path(__file__).with_name('healthcheck.py'))
healthcheck = importlib.util.module_from_spec(spec)
spec.loader.exec_module(healthcheck)


class HealthcheckTests(unittest.TestCase):
    def test_requires_consecutive_failures(self):
        state = {}
        self.assertFalse(healthcheck.recovery_due(state, 'project', False, 1000))
        self.assertFalse(healthcheck.recovery_due(state, 'project', False, 1060))
        self.assertTrue(healthcheck.recovery_due(state, 'project', False, 1120))

    def test_success_resets_failures(self):
        state = {'project_failures': 2}
        self.assertFalse(healthcheck.recovery_due(state, 'project', True, 1000))
        self.assertEqual(state['project_failures'], 0)

    def test_recovery_has_cooldown(self):
        state = {'project_failures': 3, 'project_last_attempt': 1000}
        self.assertFalse(healthcheck.recovery_due(state, 'project', False, 1060))
        self.assertTrue(healthcheck.recovery_due(state, 'project', False, 1301))

    def run_check(self, state, outcome='restarted', rss_kib=0, healthy=False, dry_run=False):
        with patch.object(healthcheck, 'api_healthy', return_value=healthy), \
             patch.object(healthcheck, 'project_memory_kib', return_value=rss_kib), \
             patch.object(healthcheck, 'port_open', return_value=True), \
             patch.object(healthcheck, 'task_alive', return_value=True), \
             patch.object(healthcheck, 'record_sample'), \
             patch.object(healthcheck.Path, 'read_text', return_value='13191'), \
             patch.object(healthcheck.subprocess, 'run', return_value=SimpleNamespace(stdout='active')), \
             patch.object(healthcheck, 'recover_project', return_value=outcome) as recovery, \
             contextlib.redirect_stdout(io.StringIO()):
            healthcheck.check(state, dry_run=dry_run)
            return recovery.call_count

    def test_manual_stop_is_respected(self):
        state = {'project_failures': 2}
        self.assertEqual(self.run_check(state, outcome='intentionally_stopped'), 1)
        self.assertEqual(state['project_failures'], 0)

    def test_healthy_project_is_not_restarted(self):
        self.assertEqual(self.run_check({}, healthy=True, rss_kib=100000), 0)

    def test_sustained_high_memory_is_recovered(self):
        state = {'project_failures': 2}
        self.assertEqual(self.run_check(state, healthy=True, rss_kib=400 * 1024), 1)

    def test_dry_run_does_not_restart_project(self):
        self.assertEqual(self.run_check({'project_failures': 2}, dry_run=True), 0)

    def test_recovered_processes_use_independent_scope(self):
        with patch.object(healthcheck.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            self.assertEqual(healthcheck.recover_project(), 'restarted')
        command = run.call_args.args[0]
        self.assertEqual(command[0], 'systemd-run')
        self.assertIn('--scope', command)

    def test_panel_stop_return_code_is_not_failure(self):
        with patch.object(healthcheck.subprocess, 'run', return_value=SimpleNamespace(returncode=75)):
            self.assertEqual(healthcheck.recover_project(), 'intentionally_stopped')


if __name__ == '__main__':
    unittest.main()
