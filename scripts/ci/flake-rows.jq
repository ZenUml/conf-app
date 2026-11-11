def walk_suites: .suites[]? | ((.specs[]? | {file, title, tests}), walk_suites);
walk_suites | . as $s | .tests[] | {run: $run, suite: $suite, project: (.projectName // ""), file: $s.file, title: $s.title, status}
