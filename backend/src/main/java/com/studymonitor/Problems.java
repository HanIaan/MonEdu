package com.studymonitor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import java.net.URI;
import java.util.*;

@RestControllerAdvice
public class Problems {
    public static class Failure extends RuntimeException {
        final HttpStatus status;
        final String code;
        public Failure(HttpStatus status, String code, String detail) { super(detail); this.status=status; this.code=code; }
    }
    public static Failure fail(HttpStatus status, String code, String detail) { return new Failure(status,code,detail); }
    public static ProblemDetail detail(HttpStatus status, String code, String message) {
        ProblemDetail p=ProblemDetail.forStatusAndDetail(status,message);
        p.setProperty("code",code);
        return p;
    }
    private ResponseEntity<ProblemDetail> response(ProblemDetail p,HttpServletRequest request) {
        p.setInstance(URI.create(request.getRequestURI()));
        return ResponseEntity.status(p.getStatus()).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(p);
    }
    @ExceptionHandler(Failure.class)
    ResponseEntity<ProblemDetail> failure(Failure e,HttpServletRequest request) {
        ProblemDetail p=detail(e.status,e.code,e.getMessage());
        if(e.code.equals("VALIDATION_FAILED")) p.setProperty("errors",List.of(Map.of("field","body","message",e.getMessage())));
        return response(p,request);
    }
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> validation(MethodArgumentNotValidException e,HttpServletRequest request) {
        ProblemDetail p=detail(HttpStatus.BAD_REQUEST,"VALIDATION_FAILED","Request validation failed");
        p.setProperty("errors",e.getBindingResult().getFieldErrors().stream().map(f -> Map.of("field",f.getField(),"message",Objects.toString(f.getDefaultMessage(),"Invalid value"))).toList());
        return response(p,request);
    }
    @ExceptionHandler({HttpMessageNotReadableException.class,MethodArgumentTypeMismatchException.class,ConstraintViolationException.class})
    ResponseEntity<ProblemDetail> malformed(Exception e,HttpServletRequest request) {
        ProblemDetail p=detail(HttpStatus.BAD_REQUEST,"VALIDATION_FAILED","Malformed or invalid request value");
        p.setProperty("errors",List.of(Map.of("field",e instanceof MethodArgumentTypeMismatchException m ? m.getName() : "body","message","Malformed or invalid value")));
        return response(p,request);
    }
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ProblemDetail> denied(Exception e,HttpServletRequest request) { return response(detail(HttpStatus.FORBIDDEN,"FORBIDDEN","Access denied"),request); }
    @ExceptionHandler({NoHandlerFoundException.class,NoResourceFoundException.class})
    ResponseEntity<ProblemDetail> missing(Exception e,HttpServletRequest request) { return response(detail(HttpStatus.NOT_FOUND,"NOT_FOUND","Resource not found"),request); }
    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> unexpected(Exception e,HttpServletRequest request) {
        org.slf4j.LoggerFactory.getLogger(Problems.class).error("Unhandled backend error ({})",e.getClass().getName());
        return response(detail(HttpStatus.INTERNAL_SERVER_ERROR,"INTERNAL_ERROR","An internal error occurred"),request);
    }
}
