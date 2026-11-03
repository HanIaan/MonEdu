FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY gradlew build.gradle settings.gradle ./
COPY gradle ./gradle
RUN chmod +x gradlew
COPY src ./src
RUN ./gradlew --no-daemon bootJar

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --system study-monitor && useradd --system --gid study-monitor --home-dir /app study-monitor
COPY --from=build --chown=study-monitor:study-monitor /workspace/build/libs/*-SNAPSHOT.jar /app/app.jar
USER study-monitor
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
