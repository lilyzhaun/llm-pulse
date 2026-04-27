/**
 * 应用错误基类。
 * 所有需要区分 HTTP 状态码的错误都应继承此类。
 */
export class AppError extends Error {
  /** HTTP 状态码（4xx / 5xx） */
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    // 保持正确的原型链，使 instanceof 可用
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 请求参数校验失败（400） */
export class ValidationError extends AppError {
  constructor(message = "请求参数无效") {
    super(message, 400);
  }
}

/** 认证/鉴权失败（401） */
export class AuthError extends AppError {
  constructor(message = "认证失败") {
    super(message, 401);
  }
}

/** 资源不存在（404） */
export class NotFoundError extends AppError {
  constructor(message = "资源不存在") {
    super(message, 404);
  }
}

/** 上游服务（new-api）错误（502） */
export class UpstreamError extends AppError {
  constructor(message = "上游服务异常") {
    super(message, 502);
  }
}

/** 持久化/数据库错误（500） */
export class PersistenceError extends AppError {
  constructor(message = "数据持久化失败") {
    super(message, 500);
  }
}
