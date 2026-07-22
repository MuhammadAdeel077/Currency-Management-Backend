import { Injectable, PipeTransform } from '@nestjs/common';
import xss from 'xss';
import sanitizeHtml from 'sanitize-html';

@Injectable()
export class GlobalSanitizerPipe implements PipeTransform {
  private readonly sensitiveKeys = new Set([
    'password',
    'previous_password',
    'new_password',
    'confirm_password',
    'sentOtp',
    'otp',
    'code',
  ]);

  private sanitize(value: string): string {
    return sanitizeHtml(xss(value));
  }

  private shouldPreserveRawValue(key: string): boolean {
    return this.sensitiveKeys.has(key);
  }

  transform(
    value: string | Record<string, unknown> | number,
  ): string | Record<string, unknown> | number {
    if (typeof value === 'string') {
      return this.sanitize(value);
    }

    if (
      value &&
      typeof value === 'object' &&
      value?.fieldname &&
      value?.mimetype
    ) {
      return value;
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !value?.fieldname &&
      !value?.mimetype
    ) {
      for (const key in value) {
        if (typeof value[key] === 'string') {
          value[key] = this.shouldPreserveRawValue(key)
            ? value[key]
            : this.sanitize(value[key]);
        } else if (typeof value[key] === 'object' && value[key] !== null) {
          value[key] = this.transform(value[key] as Record<string, unknown>); // recurse
        }
      }
    }

    return value;
  }
}
