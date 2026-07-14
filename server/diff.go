package main

import (
	"os/exec"
)

func computeDiff(old string, new string) (string, error) {
	out, err := exec.Command("diff", "-ruN", old, new).Output()
	if eErr, ok := err.(*exec.ExitError); ok && eErr.ExitCode() == 1 {
		goto validDiff
	}
	if err != nil {
		return "", err
	}
validDiff:
	return string(out), nil
}
