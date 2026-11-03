package com.studymonitor;

import org.springframework.boot.SpringApplication;

public class TestStudyMonitorBackendApplication {

	public static void main(String[] args) {
		SpringApplication.from(StudyMonitorBackendApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
